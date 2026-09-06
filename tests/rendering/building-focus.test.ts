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
function find(node: ts.Node): void {
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'focusBuilding') method = node;
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
  `let selected; ${body};return focus;`,
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
      { tiles: [] },
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
    assert.equal(selection.position.x, center.x);
    assert.equal(selection.position.z, center.z);
  }
});
