import type { CityState } from '../../domain/types';
import type { Locale } from '../../i18n/index';
import type { StepRequest, StepResponse, StepSuccess } from './protocol';

/** Injectable transport also lets tests exercise real worker_threads. */
export interface SimulationWorker {
  onmessage: ((event: MessageEvent<StepResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: StepRequest): void;
  terminate(): void;
}
export type SimulationStepResult = StepSuccess;
interface RuntimeOptions {
  workerFactory?: () => SimulationWorker;
  onDiagnostic?: (message: string) => void;
  timeoutMs?: number;
}
interface Pending {
  request: StepRequest;
  source: CityState;
  resolve: (result: SimulationStepResult | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** No backlog: the application owns elapsed time and decides when to dispatch. */
export class SimulationRuntime {
  private worker: SimulationWorker | null = null;
  private pending: Pending | null = null;
  private generation = 0;
  private sequence = 0;
  private disposed = false;
  private lastDiagnostic = '';
  constructor(private readonly options: RuntimeOptions = {}) {}
  get busy(): boolean {
    return this.pending !== null;
  }
  get epoch(): number {
    return this.generation;
  }

  step(state: CityState, locale: Locale): Promise<SimulationStepResult | null> {
    if (this.disposed || this.pending) return Promise.resolve(null);
    try {
      if (!this.worker) {
        this.worker =
          this.options.workerFactory?.() ??
          new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
        const worker = this.worker;
        worker.onmessage = ({ data }) => {
          if (this.worker === worker) this.receive(data);
        };
        worker.onerror = (event) => {
          if (this.worker === worker) this.fail(`Simulation worker failed: ${event.message}`);
        };
        worker.onmessageerror = () => {
          if (this.worker === worker) this.fail('Simulation worker returned unreadable data.');
        };
      }
      const request: StepRequest = {
        type: 'step',
        requestId: ++this.sequence,
        epoch: this.generation,
        baseRevision: state.revision,
        cityKey: `${state.seed}:${state.size}:${state.name}`,
        state,
        locale,
      };
      return new Promise((resolve) => {
        const timer = setTimeout(
          () => this.fail('Simulation worker timed out; the next step will restart it.'),
          this.options.timeoutMs ?? 120_000,
        );
        this.pending = { request, source: state, resolve, timer };
        // postMessage synchronously snapshots the city using structured clone.
        try {
          this.worker!.postMessage(request);
        } catch (error) {
          this.fail(`Simulation worker could not start: ${String(error)}`);
        }
      });
    } catch (error) {
      this.fail(`Simulation worker unavailable: ${String(error)}`);
      return Promise.resolve(null);
    }
  }

  /** Call before replacing the city or mutating simulation inputs, even without revision changes. */
  invalidate(): void {
    this.generation++;
    if (this.pending) {
      this.stopWorker();
      this.finish(null);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.invalidate();
    this.stopWorker();
  }

  private receive(response: StepResponse): void {
    const pending = this.pending;
    if (!pending || !response) return;
    const request = pending.request;
    if (
      response.requestId !== request.requestId ||
      response.epoch !== this.generation ||
      response.baseRevision !== request.baseRevision ||
      response.cityKey !== request.cityKey
    )
      return;
    if (response.type === 'error') {
      this.fail(`Simulation worker step failed: ${response.message}`);
      return;
    }
    if (response.type !== 'result') return;
    // Also reject revision changes when a caller forgot explicit invalidation.
    if (pending.source.revision !== request.baseRevision) {
      this.finish(null);
      return;
    }
    this.lastDiagnostic = '';
    this.finish(response);
  }
  private finish(result: SimulationStepResult | null): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(result);
    }
  }
  private stopWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }
  private fail(message: string): void {
    this.stopWorker();
    this.finish(null);
    if (message !== this.lastDiagnostic) {
      this.lastDiagnostic = message;
      this.options.onDiagnostic?.(message);
    }
  }
}
