import assert from 'node:assert/strict';
import test from 'node:test';
import { routeRoad } from '../../src/construction/road-routing.ts';
import { ConstructionStroke, PointerInteraction } from '../../src/construction/gesture.ts';
import {
  build,
  createCity,
  previewBuild,
  recalculate,
} from '../../src/simulation/city-simulation.ts';
import type { CityState, Point, TileKind } from '../../src/domain/types.ts';

function city(size = 40): CityState {
  const state = createCity(5106, true, size);
  for (const t of state.tiles)
    Object.assign(t, { kind: 'empty', level: 0, elevation: 1, anchor: -1 });
  state.money = 1_000_000;
  recalculate(state);
  return state;
}
function block(
  state: CityState,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  kind: TileKind = 'residential',
) {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) state.tiles[z * state.size + x].kind = kind;
}
function connected(path: Point[]) {
  assert.ok(path.length);
  assert.equal(new Set(path.map((p) => `${p.x},${p.z}`)).size, path.length);
  for (let i = 1; i < path.length; i++)
    assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].z - path[i - 1].z), 1);
}
for (const kind of ['residential', 'commercial', 'industrial'] as const) {
  for (const [start, end] of [
    [
      { x: 7, z: 10 },
      { x: 18, z: 14 },
    ],
    [
      { x: 18, z: 10 },
      { x: 7, z: 14 },
    ],
    [
      { x: 7, z: 14 },
      { x: 18, z: 10 },
    ],
    [
      { x: 18, z: 14 },
      { x: 7, z: 10 },
    ],
  ])
    test(`${kind} undeveloped block routes around in quadrant ${start.x},${start.z}`, () => {
      const state = city();
      block(state, 10, 9, 15, 15, kind);
      const before = JSON.stringify(state),
        route = routeRoad(state, start, end);
      connected(route);
      assert.deepEqual(route[0], start);
      assert.deepEqual(route.at(-1), end);
      assert.ok(route.every((p) => state.tiles[p.z * state.size + p.x].kind === 'empty'));
      assert.deepEqual(routeRoad(state, start, end), route, 'Routing is deterministic');
      assert.equal(JSON.stringify(state), before, 'Routing is read-only');
      const preview = previewBuild(state, route, 'road'),
        result = build(state, route, 'road');
      assert.ok(result.ok);
      assert.equal(result.count, preview.count);
      assert.equal(result.cost, preview.cost);
      assert.equal(state.tiles.filter((t) => t.kind === kind).length, 42);
    });
}
test('straight path stays straight and obstacles introduce few orthogonal bends', () => {
  const state = city(),
    start = { x: 4, z: 12 },
    end = { x: 24, z: 12 };
  assert.equal(routeRoad(state, start, end).length, 21);
  block(state, 10, 10, 17, 14);
  const route = routeRoad(state, start, end);
  connected(route);
  let bends = 0;
  for (let i = 2; i < route.length; i++)
    if (
      route[i].x - route[i - 1].x !== route[i - 1].x - route[i - 2].x ||
      route[i].z - route[i - 1].z !== route[i - 1].z - route[i - 2].z
    )
      bends++;
  assert.ok(bends <= 3, `Expected perimeter route, got ${bends} bends`);
});
test('facilities and full lot ownership remain protected, including a malformed empty member', () => {
  const state = city();
  block(state, 9, 9, 16, 16, 'airport');
  const owner = 9 * state.size + 9;
  for (let z = 9; z <= 16; z++)
    for (let x = 9; x <= 16; x++) state.tiles[z * state.size + x].anchor = owner;
  state.tiles[12 * state.size + 12].kind = 'empty';
  const route = routeRoad(state, { x: 5, z: 12 }, { x: 22, z: 12 });
  connected(route);
  assert.ok(route.every((p) => p.x < 9 || p.x > 16 || p.z < 9 || p.z > 16));
});
test('one-tile corridor remains usable, including existing roads without charging them twice', () => {
  const state = city();
  block(state, 0, 0, 39, 39);
  block(state, 2, 20, 35, 20, 'empty');
  block(state, 10, 20, 15, 20, 'road');
  const route = routeRoad(state, { x: 2, z: 20 }, { x: 35, z: 20 });
  connected(route);
  assert.equal(route.length, 34);
  const preview = previewBuild(state, route, 'road'),
    result = build(state, route, 'road');
  assert.ok(result.ok);
  assert.equal(result.count, 28);
  assert.equal(result.cost, preview.cost);
});
test('blocked endpoint snaps to its nearest reachable perimeter and blocked anchor never moves', () => {
  const state = city();
  block(state, 10, 10, 16, 16);
  const route = routeRoad(state, { x: 3, z: 13 }, { x: 11, z: 13 });
  connected(route);
  assert.deepEqual(route.at(-1), { x: 9, z: 13 });
  assert.deepEqual(routeRoad(state, { x: 11, z: 13 }, { x: 3, z: 13 }), []);
});
test('unreachable route and excessive world detour return no partial construction', () => {
  const state = city(128);
  block(state, 50, 0, 50, 127);
  assert.deepEqual(routeRoad(state, { x: 48, z: 64 }, { x: 52, z: 64 }), []);
  state.tiles[50].kind = 'empty';
  assert.deepEqual(routeRoad(state, { x: 48, z: 64 }, { x: 52, z: 64 }), []);
  assert.deepEqual(routeRoad(state, { x: -1, z: 1 }, { x: 4, z: 1 }), []);
});
test('water retains bridge construction and elevated dry terrain is traversable', () => {
  const state = city();
  block(state, 15, 0, 17, 39, 'water');
  for (const t of state.tiles) t.elevation = t.kind === 'water' ? -2 : 4;
  const route = routeRoad(state, { x: 10, z: 20 }, { x: 22, z: 20 });
  connected(route);
  const preview = previewBuild(state, route, 'road');
  assert.equal(preview.invalid.length, 0);
  assert.ok(build(state, route, 'road').ok);
  assert.equal(state.tiles[20 * state.size + 16].kind, 'road');
});
test('road drag shrink and reverse replace the complete preview, and cancel cannot commit', () => {
  const state = city(),
    start = { x: 4, z: 12 };
  block(state, 10, 10, 16, 14);
  const stroke = new ConstructionStroke('road', 12, state.size, start, (a, b) =>
    routeRoad(state, a, b),
  );
  stroke.update({ x: 24, z: 12 });
  const previous = stroke.points;
  assert.ok(previous.length > 20);
  stroke.update({ x: 6, z: 12 });
  assert.deepEqual(stroke.points, [
    { x: 4, z: 12 },
    { x: 5, z: 12 },
    { x: 6, z: 12 },
  ]);
  stroke.update({ x: 2, z: 12 });
  assert.deepEqual(stroke.points, [
    { x: 4, z: 12 },
    { x: 3, z: 12 },
    { x: 2, z: 12 },
  ]);
  stroke.update(start);
  assert.deepEqual(stroke.points, [start]);
  assert.ok(previous.length > 20, 'Previous preview remains a snapshot');
  const pointer = new PointerInteraction();
  pointer.begin(1, 0);
  pointer.cancel();
  assert.equal(pointer.release(1, 0, true), 'ignore');
});
test('128-square-grid routing remains practical during pointer movement', () => {
  const state = city(128);
  block(state, 40, 40, 88, 88);
  const began = performance.now();
  for (let i = 0; i < 20; i++) connected(routeRoad(state, { x: 10, z: 64 }, { x: 110, z: 54 + i }));
  assert.ok(
    performance.now() - began < 2000,
    'Twenty full-city drag updates should finish within two seconds',
  );
});
