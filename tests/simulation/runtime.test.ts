import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  SimulationRuntime,
  type SimulationWorker,
} from '../../src/simulation/runtime/controller.ts';
import {
  executeStep,
  type StepRequest,
  type StepResponse,
} from '../../src/simulation/runtime/protocol.ts';
import { createCity, tick } from '../../src/simulation/city-simulation.ts';
import { getLocale, setLocale } from '../../src/i18n/index.ts';

class FakeWorker implements SimulationWorker {
  onmessage: SimulationWorker['onmessage'] = null;
  onerror: SimulationWorker['onerror'] = null;
  onmessageerror: SimulationWorker['onmessageerror'] = null;
  requests: StepRequest[] = [];
  terminated = false;
  postMessage(request: StepRequest) {
    this.requests.push(structuredClone(request));
  }
  terminate() {
    this.terminated = true;
  }
  reply() {
    this.onmessage?.({ data: executeStep(this.requests[0]) } as MessageEvent<StepResponse>);
  }
}
test('worker protocol matches synchronous simulation and preserves locale', () => {
  const city = createCity(82, true, 40),
    expected = structuredClone(city);
  setLocale('en');
  tick(expected);
  setLocale('de');
  const result = executeStep({
    type: 'step',
    requestId: 1,
    epoch: 0,
    baseRevision: city.revision,
    cityKey: 'test',
    state: structuredClone(city),
    locale: 'en',
  });
  assert.equal(result.type, 'result');
  if (result.type === 'result') assert.deepEqual(result.state, expected);
  assert.equal(getLocale(), 'de');
  assert.equal(city.month, 0);
});
test('one dispatch only; old revisions and invalidated city results cannot commit', async () => {
  const workers: FakeWorker[] = [];
  const runtime = new SimulationRuntime({
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  const city = createCity(42, true, 40);
  const pending = runtime.step(city, 'de');
  assert.equal(runtime.busy, true);
  assert.equal(await runtime.step(city, 'de'), null);
  city.revision++;
  workers[0].reply();
  assert.equal(await pending, null);
  const obsolete = runtime.step(city, 'de');
  const lateCallback = workers[0].onmessage;
  runtime.invalidate();
  assert.equal(await obsolete, null);
  assert.ok(workers[0].terminated);
  const fresh = runtime.step(createCity(99, true, 40), 'en');
  lateCallback?.({ data: executeStep(workers[0].requests[1]) } as MessageEvent<StepResponse>);
  assert.equal(runtime.busy, true);
  workers[1].reply();
  assert.ok(await fresh);
  runtime.dispose();
  assert.equal(await runtime.step(city, 'de'), null);
});
test('worker failure and timeout resolve pending work and allow retry', async () => {
  const workers: FakeWorker[] = [],
    messages: string[] = [];
  const runtime = new SimulationRuntime({
    timeoutMs: 15,
    onDiagnostic: (message) => messages.push(message),
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  const city = createCity(42, true, 40);
  const failed = runtime.step(city, 'de');
  workers[0].onerror?.({ message: 'crash' } as ErrorEvent);
  assert.equal(await failed, null);
  assert.ok(workers[0].terminated);
  assert.equal(await runtime.step(city, 'de'), null);
  assert.match(messages[1], /timed out/);
  const retry = runtime.step(city, 'de');
  workers[2].reply();
  assert.ok(await retry);
  runtime.dispose();
});
test('unsupported workers and structured-clone failures are explicit and never leave a busy runtime', async () => {
  const messages: string[] = [];
  const runtime = new SimulationRuntime({
    onDiagnostic: (message) => messages.push(message),
    workerFactory: () => {
      throw new Error('unsupported');
    },
  });
  const city = createCity(42, true, 40);
  assert.equal(await runtime.step(city, 'de'), null);
  assert.equal(await runtime.step(city, 'de'), null);
  assert.equal(runtime.busy, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /unavailable/);
  runtime.dispose();
  const worker = new FakeWorker();
  worker.postMessage = () => {
    throw new Error('clone failed');
  };
  const cloneRuntime = new SimulationRuntime({
    workerFactory: () => worker,
    onDiagnostic: (message) => messages.push(message),
  });
  assert.equal(await cloneRuntime.step(city, 'de'), null);
  assert.ok(worker.terminated);
  assert.equal(cloneRuntime.busy, false);
  assert.match(messages[1], /clone failed/);
  cloneRuntime.dispose();
});
test('real isolated worker transport returns deterministic complete city without mutating source', async () => {
  const protocolUrl = new URL('../../src/simulation/runtime/protocol.ts', import.meta.url).href;
  const nodeWorker = new Worker(
    `const {parentPort}=require('node:worker_threads');
    import('tsx/esm/api').then(async({tsImport})=>{
      const {executeStep}=await tsImport(${JSON.stringify(protocolUrl)}, ${JSON.stringify(import.meta.url)});
      parentPort.on('message',request=>parentPort.postMessage(executeStep(request)));
    });`,
    { eval: true },
  );
  const adapter: SimulationWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: (request) => nodeWorker.postMessage(request),
    terminate: () => {
      void nodeWorker.terminate();
    },
  };
  nodeWorker.on('message', (data) => adapter.onmessage?.({ data } as MessageEvent<StepResponse>));
  nodeWorker.on('error', (error) => adapter.onerror?.({ message: error.message } as ErrorEvent));
  const runtime = new SimulationRuntime({ workerFactory: () => adapter });
  try {
    const city = createCity(83, true, 40),
      snapshot = structuredClone(city),
      expected = structuredClone(city);
    tick(expected);
    const result = await runtime.step(city, 'de');
    assert.ok(result);
    assert.deepEqual(result.state, expected);
    assert.deepEqual(city, snapshot);
    assert.ok(result.durationMs >= 0);
  } finally {
    runtime.dispose();
  }
});
