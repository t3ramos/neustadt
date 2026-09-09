import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';

// Exercise the actual scene API method without constructing a WebGL context.
const source = ts.createSourceFile(
  'scene.ts',
  readFileSync(new URL('../../src/rendering/scene.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
let method: ts.MethodDeclaration | undefined;
let resetMethod: ts.FunctionDeclaration | undefined;
function find(node: ts.Node): void {
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'focusBuilding') method = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'resetCamera') resetMethod = node;
  ts.forEachChild(node, find);
}
find(source);
assert.ok(method?.body, 'scene exposes focusBuilding');
const body = ts.transpile(`function focus(x:number,z:number) ${method.body.getText(source)}`, {
  target: ts.ScriptTarget.ES2022,
});
const makeFocus = new Function(
  'THREE',
  'camera',
  'controls',
  'state',
  'half',
  'tileAt',
  'getFootprint',
  'selection',
  'callbacks',
  'driving',
  'exitDrive',
  `let selected; const size=state.size; function refreshSelection(){ selection.visible = true; } ${body};return focus;`,
);

test('building close-up centers its actual footprint at desktop and portrait aspect ratios', () => {
  for (const [width, height] of [
    [1629, 1180],
    [1151, 1180],
    [1440, 900],
    [700, 1000],
    [375, 812],
  ]) {
    const spanY = 34,
      spanX = (spanY * width) / height,
      shift = width > 900 ? 0.085 : 0;
    const camera = new THREE.OrthographicCamera(
      -spanX * (0.5 + shift),
      spanX * (0.5 - shift),
      spanY * 0.47,
      -spanY * 0.53,
      0.01,
      500,
    );
    const tile = { x: 34, z: 48, anchor: -1, elevation: 0, rotation: 0 };
    const cells = Array.from({ length: 6 }, (_, i) => ({
      x: tile.x + (i % 3),
      z: tile.z + Math.floor(i / 3),
    }));
    const controls = {
      target: new THREE.Vector3(),
      minPolarAngle: 0.16 * Math.PI,
      minZoom: 0.2,
      maxZoom: 7,
      update() {
        camera.lookAt(this.target);
        camera.updateMatrixWorld(true);
      },
    };
    const selection = new THREE.Object3D();
    let selected: { x: number; z: number } | undefined;
    const focus = makeFocus(
      THREE,
      camera,
      controls,
      { size: 96, tiles: [] },
      48,
      () => tile,
      () => cells,
      selection,
      {
        onSelect: (point: typeof selected) => {
          selected = point;
        },
      },
      { active: false },
      () => {},
    );
    focus(tile.x, tile.z);
    const center = new THREE.Vector3(-12.5, 0.55, 1);
    const screen = center.clone().project(camera);
    assert.ok(
      Math.abs(screen.x) < 1e-10 && Math.abs(screen.y) < 1e-10,
      `footprint center stays centered at ${width}x${height}: ${screen.x},${screen.y}`,
    );
    assert.ok(
      controls.target.distanceTo(center) < 1e-10,
      'orbit pivot stays on the building, not a nearby park',
    );
    assert.deepEqual(selected, { x: 34, z: 48 });
    assert.equal(selection.visible, true, 'focus refreshes the shared ground-conforming selection');
  }
});

assert.ok(resetMethod?.body, 'scene exposes camera reset');
const resetBody = ts.transpile(`function resetCamera() ${resetMethod.body.getText(source)}`, {
  target: ts.ScriptTarget.ES2022,
});
const makeReset = new Function(
  'THREE',
  'camera',
  'controls',
  'state',
  'size',
  'half',
  'tileAt',
  'driving',
  'exitDrive',
  `${resetBody};return resetCamera;`,
);

function returnContext(width: number, height: number, size: number, rotation = 0) {
  const spanY = 34,
    spanX = (spanY * width) / height;
  const camera = new THREE.OrthographicCamera(
    -spanX * 0.585,
    spanX * 0.415,
    spanY * 0.47,
    -spanY * 0.53,
    0.1,
    Math.max(500, size * 5),
  );
  const tile = { kind: 'commercial', level: 4, x: 34, z: 48, anchor: -1, elevation: 0, rotation };
  const state = { size, tiles: [tile] };
  const controls = {
    target: new THREE.Vector3(),
    minPolarAngle: 0.16 * Math.PI,
    minZoom: 0.2,
    maxZoom: 7,
    update() {
      camera.lookAt(this.target);
      camera.updateMatrixWorld(true);
    },
  };
  const cells = Array.from({ length: 6 }, (_, i) => ({
    x: tile.x + (i % 3),
    z: tile.z + Math.floor(i / 3),
  }));
  const focus = makeFocus(
    THREE,
    camera,
    controls,
    state,
    size / 2,
    () => tile,
    () => cells,
    new THREE.Object3D(),
    { onSelect() {} },
    { active: false },
    () => {},
  );
  const reset = makeReset(
    THREE,
    camera,
    controls,
    state,
    size,
    size / 2,
    () => tile,
    { active: false },
    () => {},
  );
  return { camera, controls, tile, focus, reset };
}
function assertMapDepth(camera: THREE.OrthographicCamera, size: number, label: string) {
  camera.zoom = 0.2;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  for (const x of [-size / 2, size / 2])
    for (const z of [-size / 2, size / 2])
      for (const y of [0, 25]) {
        const ndc = new THREE.Vector3(x, y, z).project(camera);
        assert.ok(
          ndc.z >= -1 && ndc.z <= 1,
          `${label}: map corner ${x},${y},${z} crosses camera clipping plane at zoom-out (depth ${ndc.z})`,
        );
      }
}

test('return from office close-up keeps the entire map in front of the near plane when zooming out', () => {
  for (const size of [96, 128])
    for (const [width, height] of [
      [1632, 1180],
      [1151, 1180],
      [375, 812],
    ])
      for (const rotation of [0, 1, 2, 3]) {
        const { camera, controls, tile, focus } = returnContext(width, height, size, rotation);
        focus(tile.x, tile.z);
        const expected = new THREE.Vector3(-5.5, 8, 8)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), (-rotation * Math.PI) / 2)
          .normalize();
        assert.ok(
          camera.position.clone().sub(controls.target).normalize().distanceTo(expected) < 1e-10,
          'street-facing viewing angle stays unchanged',
        );
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(0, 0), camera);
        const picked = ray.ray.intersectPlane(
          new THREE.Plane().setFromNormalAndCoplanarPoint(
            camera.getWorldDirection(new THREE.Vector3()),
            controls.target,
          ),
          new THREE.Vector3(),
        );
        assert.ok(
          picked && picked.distanceTo(controls.target) < 1e-8,
          'center picking still hits the true building pivot',
        );
        assertMapDepth(
          camera,
          size,
          `office return ${size} ${width}x${height} rotation${rotation}`,
        );
      }
});

test('normal city camera retained after driving keeps elevated map corners within depth bounds at zoom-out', () => {
  for (const size of [96, 128])
    for (const [width, height] of [
      [1632, 1180],
      [1151, 1180],
      [375, 812],
    ]) {
      const { camera, controls, reset } = returnContext(width, height, size);
      reset();
      const expected = new THREE.Vector3(-42, 42, 48).normalize();
      assert.ok(
        camera.position.clone().sub(controls.target).normalize().distanceTo(expected) < 1e-10,
        'normal city angle stays unchanged',
      );
      assertMapDepth(camera, size, `city return ${size} ${width}x${height}`);
    }
});
