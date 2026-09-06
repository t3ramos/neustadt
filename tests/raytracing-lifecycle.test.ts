import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh';
import { PathTracingSceneGenerator } from 'three-gpu-pathtracer';
import { CityPathTracer, createPathTracingSnapshot } from '../src/raytracing.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = () => yes(); });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function city() {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial({ color: 0x99bb66 });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return { scene, mesh, geometry, material, dispose() { geometry.dispose(); material.dispose(); } };
}

type BuildPlan = { gate?: Promise<void>; fail?: boolean; started?: ReturnType<typeof deferred> };
function harness(plans: BuildPlan[] = []) {
  const source = city();
  const originalShaderError = () => {};
  const renderer = {
    debug: { onShaderError: originalShaderError, checkShaderErrors: false },
    extensions: { has: () => true },
    getContext: () => ({ isContextLost: () => false, getShaderPrecisionFormat: () => ({ precision: 23 }) }),
  } as unknown as THREE.WebGLRenderer;
  const controller = new CityPathTracer(renderer, source.scene, new THREE.PerspectiveCamera(), () => false);
  let concurrent = 0, maximumConcurrent = 0;
  const backends: ReturnType<typeof makeBackend>[] = [];
  function makeBackend(plan: BuildPlan) {
    const generator = new PathTracingSceneGenerator();
    const counts = { worker: 0, tracer: 0, denoiser: 0, quad: 0, snapshotGeometry: 0, generatedGeometry: 0, render: 0 };
    let pending = false;
    const worker = {
      async generate(geometry: THREE.BufferGeometry, options?: MeshBVHOptions) {
        pending = true;
        maximumConcurrent = Math.max(maximumConcurrent, ++concurrent);
        plan.started?.resolve();
        try {
          if (plan.gate) await plan.gate;
          if (plan.fail) throw new Error('Simulated BVH worker failure');
          return new MeshBVH(geometry, { ...options, maxLeafSize: 1 } as MeshBVHOptions);
        } finally { pending = false; concurrent--; }
      },
      dispose() { assert.equal(pending, false, 'Do not terminate a worker while it owns pending geometry'); counts.worker++; },
    };
    generator.setBVHWorker(worker);
    generator.geometry.addEventListener('dispose', () => counts.generatedGeometry++);
    const tracer = {
      _generator: generator,
      samples: 0, enablePathTracing: false, pausePathTracing: false,
      tiles: new THREE.Vector2(), textureSize: new THREE.Vector2(),
      async setSceneAsync(scene: THREE.Scene, _camera: THREE.Camera, options: { onProgress?: (value: number) => void }) {
        scene.traverse(object => {
          if (object instanceof THREE.Mesh) object.geometry.addEventListener('dispose', () => counts.snapshotGeometry++);
        });
        generator.setObjects(scene);
        const result = generator.generateAsync(options.onProgress);
        // Upstream may dispose the empty destination while replacing its
        // attributes. Count terminal teardown only, after synchronous setup.
        counts.generatedGeometry = 0;
        return result;
      },
      updateCamera() {}, reset() { this.samples = 0; },
      renderSample() { counts.render++; this.samples++; },
      dispose() { assert.equal(pending, false); counts.tracer++; },
    };
    return { tracer, worker, counts, generator, denoiseMaterial: { dispose() { counts.denoiser++; } }, denoiseQuad: { dispose() { counts.quad++; } } };
  }
  // Exercise the real wrapper, snapshots, and installed async BVH generator.
  // Only constructing a WebGLPathTracer and its GPU quads is replaced here.
  Reflect.set(controller, 'createBackend', async () => {
    const backend = makeBackend(plans[backends.length] ?? {});
    backends.push(backend);
    return backend;
  });
  return { controller, renderer, backends, source, originalShaderError, maximumConcurrent: () => maximumConcurrent, dispose() { controller.dispose(); source.dispose(); } };
}

function released(backend: ReturnType<ReturnType<typeof harness>['backends']['at']>) {
  assert.ok(backend);
  assert.equal(backend.counts.tracer, 1);
  assert.equal(backend.counts.worker, 1);
  assert.equal(backend.counts.denoiser, 1);
  assert.equal(backend.counts.quad, 1);
  assert.equal(backend.counts.generatedGeometry, 1);
  assert.equal(backend.counts.snapshotGeometry, 1);
}

test('failed actual async BVH generator is discarded and the next photo attempt succeeds', async t => {
  const h = harness([{ fail: true }, {}]);
  t.mock.method(console, 'error', () => {});
  try {
    assert.equal(await h.controller.setEnabled(true), false);
    assert.match(h.controller.getStatus().error!, /BVH worker failure/);
    const poisonedGenerator = h.backends[0].generator;
    // This is the actual upstream regression: generateAsync retains its
    // rejected promise as bvh. Reusing it enters an unresolved queue branch.
    const retained = Reflect.get(poisonedGenerator, 'bvh');
    assert.ok(retained instanceof Promise);
    await assert.rejects(retained, /BVH worker failure/);
    released(h.backends[0]);
    assert.equal(h.renderer.debug.onShaderError, h.originalShaderError);

    assert.equal(await h.controller.setEnabled(true), true);
    assert.equal(h.backends.length, 2);
    assert.notEqual(h.backends[1].generator, poisonedGenerator);
    assert.ok(h.backends[1].generator.bvh instanceof MeshBVH);
    assert.equal(h.controller.getStatus().error, undefined);
    assert.equal(h.controller.render(), true);
    assert.equal(h.controller.getStatus().samples, 1);
  } finally { h.dispose(); }
  released(h.backends[1]);
});

test('Cancel restores realtime immediately; pending worker cleanup precedes a rapid re-entry', async () => {
  const gate = deferred(), started = deferred();
  const h = harness([{ gate: gate.promise, started }, {}]);
  try {
    const firstEntry = h.controller.setEnabled(true);
    await started.promise;
    assert.equal(await h.controller.setEnabled(false), true);
    assert.equal(h.controller.render(), false);
    assert.equal(h.controller.getStatus().mode, 'realtime');
    assert.equal(h.renderer.debug.onShaderError, h.originalShaderError);
    assert.equal(h.backends[0].counts.worker, 0, 'Pending transferred data must finish before worker disposal');
    const secondEntry = h.controller.setEnabled(true);
    await tick();
    assert.equal(h.backends.length, 1, 'Do not race the old generator with another worker');
    gate.resolve();
    assert.equal(await firstEntry, false, 'The obsolete enable request must not publish success');
    assert.equal(await secondEntry, true);
    assert.equal(h.maximumConcurrent(), 1);
    released(h.backends[0]);
    assert.equal(h.controller.getStatus().mode, 'raytracing');
    assert.equal(h.controller.render(), true);
  } finally { gate.resolve(); h.dispose(); }
  released(h.backends[1]);
});

test('disposal during worker execution cannot re-enable photo mode or leak pending resources', async () => {
  const gate = deferred(), started = deferred();
  const h = harness([{ gate: gate.promise, started }]);
  try {
    const entry = h.controller.setEnabled(true);
    await started.promise;
    h.controller.dispose();
    h.controller.dispose();
    assert.equal(await h.controller.setEnabled(true), false);
    assert.equal(h.controller.render(), false);
    assert.equal(h.backends[0].counts.worker, 0);
    gate.resolve();
    assert.equal(await entry, false);
    assert.equal(h.controller.getStatus().mode, 'realtime');
    released(h.backends[0]);
  } finally { gate.resolve(); h.dispose(); }
  released(h.backends[0]);
});

test('scene revision changes discard an in-flight build and publish only the latest coherent city', async () => {
  const gate = deferred(), started = deferred();
  const h = harness([{ gate: gate.promise, started }, {}]);
  try {
    const entry = h.controller.setEnabled(true);
    await started.promise;
    h.source.mesh.position.x = 80;
    h.controller.invalidate();
    gate.resolve();
    assert.equal(await entry, true, 'A single entry waits for the latest revision rather than returning stale failure');
    assert.equal(h.backends.length, 2);
    released(h.backends[0]);
    const positions = h.backends[1].generator.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) assert.ok(positions.getX(i) >= 79.5);
    assert.equal(h.controller.getStatus().mode, 'raytracing');
  } finally { gate.resolve(); h.dispose(); }
});

test('the last finished photo continues rendering during rebuild; failure falls back and remains retryable', async t => {
  const gate = deferred(), started = deferred();
  const h = harness([{}, { gate: gate.promise, started, fail: true }, {}]);
  t.mock.method(console, 'error', () => {});
  try {
    assert.equal(await h.controller.setEnabled(true), true);
    assert.equal(h.controller.render(), true);
    h.controller.invalidate();
    assert.equal(h.controller.render(), true);
    await started.promise;
    const previousFrames = h.backends[0].counts.render;
    assert.equal(h.controller.render(), true);
    assert.equal(h.backends[0].counts.render, previousFrames + 1);
    assert.equal(h.backends[0].counts.tracer, 0);
    const build = Reflect.get(h.controller, 'building') as Promise<boolean>;
    gate.resolve();
    assert.equal(await build, false);
    assert.equal(h.controller.render(), false);
    assert.match(h.controller.getStatus().error!, /BVH worker failure/);
    released(h.backends[0]);
    released(h.backends[1]);
    assert.equal(await h.controller.setEnabled(true), true);
    assert.equal(h.controller.render(), true);
  } finally { gate.resolve(); h.dispose(); }
});

test('repeated entry and exit release every photo snapshot exactly once without touching the live scene', async () => {
  const h = harness();
  let liveGeometryDisposals = 0, liveMaterialDisposals = 0;
  h.source.geometry.addEventListener('dispose', () => liveGeometryDisposals++);
  h.source.material.addEventListener('dispose', () => liveMaterialDisposals++);
  try {
    for (let index = 0; index < 5; index++) {
      assert.equal(await h.controller.setEnabled(true), true);
      assert.equal(h.controller.render(), true);
      assert.equal(await h.controller.setEnabled(false), true);
      assert.equal(await h.controller.setEnabled(false), true);
      assert.equal(h.controller.render(), false);
      released(h.backends[index]);
    }
    assert.equal(liveGeometryDisposals, 0);
    assert.equal(liveMaterialDisposals, 0);
    assert.equal(h.source.scene.children.length, 1);
  } finally { h.dispose(); }
  h.backends.forEach(released);
});

test('snapshot captures transforms, instance colors, material and geometry before its first asynchronous yield', async () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const instances = new THREE.InstancedMesh(geometry, material, 260);
  for (let index = 0; index < instances.count; index++) {
    instances.setMatrixAt(index, new THREE.Matrix4().makeTranslation(index * 2, 0, 0));
    instances.setColorAt(index, new THREE.Color(0.25, 0.5, 0.75));
  }
  scene.add(instances);
  const snapshotPromise = createPathTracingSnapshot(scene);
  instances.position.x = 999;
  instances.setMatrixAt(150, new THREE.Matrix4().makeTranslation(-999, 0, 0));
  instances.setColorAt(150, new THREE.Color(1, 0, 0));
  geometry.translate(999, 0, 0);
  material.color.set(0x0000ff);
  instances.count = 1;
  scene.remove(instances);
  const snapshot = await snapshotPromise;
  try {
    const mesh = snapshot.scene.children[0] as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    const colors = mesh.geometry.getAttribute('color');
    assert.equal(positions.count, 260 * geometry.getAttribute('position').count);
    assert.ok(Math.abs(positions.getX(150 * 24) - 300) <= 0.51);
    assert.equal(colors.getX(150 * 24), 0.25);
    assert.equal(colors.getY(150 * 24), 0.5);
    assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHex(), 0xff0000);
  } finally { snapshot.dispose(); snapshot.dispose(); geometry.dispose(); material.dispose(); }
});

test('Cancel interrupts large snapshot expansion at its next yield and frees every partial geometry', async t => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  const instances = new THREE.InstancedMesh(geometry, material, 4096);
  scene.add(instances);
  let canceled = false;
  const cloneDisposals = new Map<THREE.BufferGeometry, number>();
  const clone = THREE.BufferGeometry.prototype.clone;
  t.mock.method(THREE.BufferGeometry.prototype, 'clone', function (this: THREE.BufferGeometry) {
    const copy = clone.call(this);
    cloneDisposals.set(copy, 0);
    copy.addEventListener('dispose', () => cloneDisposals.set(copy, cloneDisposals.get(copy)! + 1));
    return copy;
  });
  try {
    const snapshot = createPathTracingSnapshot(scene, false, () => canceled);
    setTimeout(() => { canceled = true; }, 0);
    await assert.rejects(snapshot, { name: 'AbortError' });
    assert.ok(cloneDisposals.size >= 1);
    assert.ok(cloneDisposals.size <= 130, `Cancellation must not expand all 4096 instances (${cloneDisposals.size} clones)`);
    for (const count of cloneDisposals.values()) assert.equal(count, 1);
    assert.equal(instances.count, 4096);
    assert.equal(scene.children.length, 1);
  } finally { geometry.dispose(); material.dispose(); }
});

test('teardown releases actual dependency-owned GPU buffers once and preserves borrowed textures', async () => {
  const h = harness();
  const library = await import('three-gpu-pathtracer');
  const PhysicalMaterial = Reflect.get(library, 'PhysicalPathTracingMaterial') as new () => THREE.ShaderMaterial;
  const material = new PhysicalMaterial();
  const borrowed = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const colorBackground = new THREE.DataTexture();
  const internalBackground = new THREE.DataTexture();
  const mainBlend = new THREE.MeshBasicMaterial(), lowBlend = new THREE.MeshBasicMaterial();
  const counts = new Map<string, number>();
  const watch = (name: string, resource: { addEventListener(type: 'dispose', callback: () => void): void }) => {
    counts.set(name, 0);
    resource.addEventListener('dispose', () => counts.set(name, counts.get(name)! + 1));
  };
  watch('physical material', material);
  watch('color background', colorBackground);
  watch('internal background', internalBackground);
  watch('main blend material', mainBlend);
  watch('low resolution blend material', lowBlend);
  let borrowedDisposals = 0;
  borrowed.addEventListener('dispose', () => borrowedDisposals++);
  const uniform = (name: string) => material.uniforms[name].value;
  for (const name of ['attributesArray', 'materialIndexAttribute', 'materials', 'stratifiedTexture', 'stratifiedOffsetTexture']) watch(name, uniform(name));
  for (const name of ['index', 'position', 'bvhBounds', 'bvhContents']) watch(`bvh ${name}`, uniform('bvh')[name]);
  for (const name of ['marginalWeights', 'conditionalWeights', 'map']) watch(`environment ${name}`, uniform('envMapInfo')[name]);
  watch('lights', uniform('lights').tex);
  const framebufferOwners = new Map<THREE.Texture, { __renderTarget: THREE.WebGLRenderTarget }>();
  Reflect.set(h.renderer, 'properties', { get: (texture: THREE.Texture) => framebufferOwners.get(texture) });
  const uploadRenderer = {
    getRenderTarget: () => null, getClearAlpha: () => 0,
    getClearColor: (color: THREE.Color) => color.set(0), setClearColor() {},
    toneMapping: THREE.NoToneMapping, render() {},
    setRenderTarget(target: THREE.WebGLRenderTarget | null) {
      if (target) framebufferOwners.set(target.texture, { __renderTarget: target });
    },
  };
  for (const name of ['textures', 'iesProfiles']) {
    // Run the actual dependency upload path to discover its hidden target.
    // The shim records Three's normal framebuffer ownership without a GPU.
    uniform(name).setTextures(uploadRenderer, [borrowed], 1, 1);
    assert.equal(uniform(name).renderTarget, null, 'The array-target replacement loses the public back-reference');
    const target = framebufferOwners.get(uniform(name))?.__renderTarget as THREE.WebGLRenderTarget & { fsQuad: { material: THREE.Material } };
    assert.ok(target, 'Uploaded array targets must be recovered from renderer properties');
    watch(`${name} render target`, target);
    watch(`${name} copy material`, target.fsQuad.material);
  }
  material.uniforms.backgroundMap.value = borrowed;
  material.uniforms.sobolTexture.value = borrowed;
  let lowResolutionDisposals = 0;
  const onRecompile = () => {};
  Reflect.apply(material.addEventListener, material, ['recompilation', onRecompile]);
  try {
    assert.equal(await h.controller.setEnabled(true), true);
    Object.assign(h.backends[0].tracer, {
      _pathTracer: { material, _blendQuad: { material: mainBlend }, _compileFunction: onRecompile },
      // Sharing can occur upstream. Release the same physical material once.
      _lowResPathTracer: { material, _blendQuad: { material: lowBlend }, _compileFunction: onRecompile, dispose() { lowResolutionDisposals++; } },
      _colorBackground: colorBackground, _internalBackground: internalBackground,
    });
    assert.equal(await h.controller.setEnabled(false), true);
    h.controller.dispose();
    for (const [name, count] of counts) assert.equal(count, 1, `${name} must be released exactly once`);
    assert.equal(lowResolutionDisposals, 1);
    assert.equal(borrowedDisposals, 0, 'Background and Sobol references must not be swept as owned material textures');
    assert.equal(Reflect.get(material, '_listeners').recompilation.length, 0);
  } finally { h.dispose(); borrowed.dispose(); }
});
