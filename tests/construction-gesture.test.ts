import assert from 'node:assert/strict';
import test from 'node:test';
import { brushFootprint, ConstructionStroke, PointerInteraction } from '../src/construction-gesture.ts';
import { build, createCity, previewBuild, recalculate, TOOL_DEFS } from '../src/simulation.ts';
import type { CityState, Point } from '../src/types.ts';

const zones = ['residential', 'commercial', 'industrial'] as const;
const lines = ['road', 'rail', 'pipe', 'powerline'] as const;
const key = (point: Point): string => `${point.x},${point.z}`;
const keys = (points: Point[]): Set<string> => new Set(points.map(key));
const rectangle = (x0: number, z0: number, x1: number, z1: number): Point[] => {
  const points: Point[] = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) points.push({ x, z });
  return points;
};
const assertConnected = (points: Point[]): void => {
  const remaining = keys(points), pending = [points[0]];
  remaining.delete(key(points[0]));
  while (pending.length) {
    const point = pending.pop()!;
    for (const neighbor of [
      { x: point.x - 1, z: point.z }, { x: point.x + 1, z: point.z },
      { x: point.x, z: point.z - 1 }, { x: point.x, z: point.z + 1 },
    ]) if (remaining.delete(key(neighbor))) pending.push(neighbor);
  }
  assert.equal(remaining.size, 0, 'Every route cell must connect through an orthogonal neighbor');
};
const flatCity = (): CityState => {
  const city = createCity(5106, true, 40);
  for (const tile of city.tiles) {
    tile.kind = 'empty'; tile.level = 0; tile.elevation = 1;
    tile.anchor = -1; tile.hasPipe = false; tile.hasPowerLine = false;
  }
  city.money = 1_000_000;
  recalculate(city);
  return city;
};

for (const tool of zones) {
  for (const [dx, dz] of [[4, 3], [-4, 3], [4, -3], [-4, -3]]) {
    test(`${tool}: dragging in quadrant ${dx},${dz} fills an inclusive rectangle`, () => {
      const start = { x: 12, z: 12 }, end = { x: start.x + dx, z: start.z + dz };
      const stroke = new ConstructionStroke(tool, 12, 40, start);
      stroke.update(end);
      assert.deepEqual(stroke.area, [5, 4]);
      assert.equal(stroke.points.length, 20);
      assert.deepEqual(keys(stroke.points), keys(rectangle(
        Math.min(start.x, end.x), Math.min(start.z, end.z),
        Math.max(start.x, end.x), Math.max(start.z, end.z),
      )));
    });
  }

  test(`${tool}: reversing and curving a drag replaces the area instead of leaving a painted trail`, () => {
    const stroke = new ConstructionStroke(tool, 12, 40, { x: 12, z: 12 });
    stroke.update({ x: 20, z: 18 });
    const largerPreview = keys(stroke.points);
    assert.equal(largerPreview.size, 63);
    stroke.update({ x: 7, z: 20 });
    stroke.update({ x: 14, z: 13 });
    assert.deepEqual(stroke.area, [3, 2]);
    assert.deepEqual(keys(stroke.points), keys(rectangle(12, 12, 14, 13)));
    assert.equal(largerPreview.size, 63, 'A previous preview remains a stable snapshot');
    stroke.update({ x: 12, z: 12 });
    assert.deepEqual(stroke.points, [{ x: 12, z: 12 }]);
    assert.deepEqual(stroke.area, [1, 1]);
  });

  test(`${tool}: one click is exactly one tile even with the largest brush selected`, () => {
    const point = { x: 8, z: 9 };
    assert.deepEqual(brushFootprint(point, tool, 12, 40), [point]);
    const stroke = new ConstructionStroke(tool, 12, 40, point);
    assert.deepEqual(stroke.points, [point]);
    assert.deepEqual(stroke.area, [1, 1]);
  });

  test(`${tool}: the final release endpoint updates the preview and committed rectangle`, () => {
    const city = flatCity(), stroke = new ConstructionStroke(tool, 12, city.size, { x: 10, z: 10 });
    stroke.update({ x: 18, z: 18 });
    stroke.update({ x: 12, z: 11 });
    const before = JSON.stringify(city), money = city.money;
    const preview = previewBuild(city, stroke.points, tool);
    assert.equal(JSON.stringify(city), before, 'Inspecting a drag must not mutate the city');
    assert.equal(preview.count, 6);
    assert.equal(preview.cost, 6 * TOOL_DEFS[tool]!.cost);
    assert.deepEqual(keys(preview.valid), keys(rectangle(10, 10, 12, 11)));
    const result = build(city, stroke.points, tool);
    assert.ok(result.ok, result.message);
    assert.equal(result.cost, preview.cost);
    assert.equal(result.count, preview.count);
    assert.equal(city.money, money - preview.cost);
    assert.deepEqual(keys(city.tiles.filter(tile => tile.kind === tool)), keys(preview.valid));
  });
}

test('zone previews can span all 128 squared city tiles without duplicate or out-of-bounds cells', () => {
  const stroke = new ConstructionStroke('residential', 12, 128, { x: 127, z: 0 });
  stroke.update({ x: 0, z: 127 });
  assert.deepEqual(stroke.area, [128, 128]);
  assert.equal(stroke.points.length, 128 ** 2);
  assert.equal(keys(stroke.points).size, 128 ** 2);
  assert.ok(stroke.points.every(point => point.x >= 0 && point.x < 128 && point.z >= 0 && point.z < 128));
});

test('zone cell generation clips endpoints beyond the city edges', () => {
  const stroke = new ConstructionStroke('commercial', 12, 128, { x: -10, z: -20 });
  stroke.update({ x: 140, z: 150 });
  assert.equal(stroke.points.length, 128 ** 2);
  assert.ok(stroke.points.every(point => point.x >= 0 && point.x < 128 && point.z >= 0 && point.z < 128));
});

test('an unchanged endpoint does not invalidate a preview, while a moved endpoint does', () => {
  const stroke = new ConstructionStroke('industrial', 1, 40, { x: 3, z: 3 });
  const initial = stroke.points, revision = stroke.revision;
  stroke.update({ x: 3, z: 3 });
  assert.equal(stroke.points, initial);
  assert.equal(stroke.revision, revision);
  stroke.update({ x: 5, z: 4 });
  assert.ok(stroke.revision > revision);
  assert.notEqual(stroke.points, initial);
  assert.equal(stroke.points.length, 6);
});

for (const tool of lines) {
  test(`${tool}: a bent and diagonal route stays connected and preserves its earlier segments`, () => {
    const stroke = new ConstructionStroke(tool, 12, 40, { x: 6, z: 6 });
    stroke.update({ x: 12, z: 6 });
    stroke.update({ x: 12, z: 10 });
    const earlierRoute = keys(stroke.points);
    stroke.update({ x: 16, z: 13 });
    const route = keys(stroke.points);
    for (const point of earlierRoute) assert.ok(route.has(point), `Lost previous ${tool} cell ${point}`);
    assert.ok(route.has('16,13'), 'The final endpoint must be included');
    assert.equal(route.size, stroke.points.length, 'Overlapping segments are not charged twice');
    assert.equal(stroke.points.length, 18, 'A wide brush cannot thicken a route');
    assert.equal(stroke.area, undefined);
    assertConnected(stroke.points);
    stroke.update({ x: 12, z: 10 });
    assert.equal(stroke.points.length, 18, 'Retracing a segment keeps the original route');
    assertConnected(stroke.points);
  });
}

for (const tool of ['raise', 'lower', 'level', 'tree', 'park', 'bulldoze'] as const) {
  test(`${tool}: terrain, nature and demolition retain a continuous square paintbrush`, () => {
    const stroke = new ConstructionStroke(tool, 3, 40, { x: 10, z: 10 });
    assert.deepEqual(keys(stroke.points), keys(rectangle(9, 9, 11, 11)));
    stroke.update({ x: 14, z: 10 });
    assert.deepEqual(keys(stroke.points), keys(rectangle(9, 9, 15, 11)));
    assert.equal(stroke.area, undefined);
    const edge = brushFootprint({ x: 0, z: 0 }, tool, 12, 128);
    assert.ok(edge.length > 1);
    assert.equal(keys(edge).size, edge.length);
    assert.ok(edge.every(point => point.x >= 0 && point.x < 128 && point.z >= 0 && point.z < 128));
  });
}

test('a large facility remains one placement when the pointer moves', () => {
  const stroke = new ConstructionStroke('airport', 12, 40, { x: 4, z: 5 });
  stroke.update({ x: 20, z: 20 });
  assert.deepEqual(stroke.points, [{ x: 4, z: 5 }]);
});

test('blocked tiles in a zoning rectangle have the same count and price in preview and construction', () => {
  const city = flatCity();
  const road = build(city, [{ x: 11, z: 11 }], 'road');
  assert.ok(road.ok, road.message);
  const stroke = new ConstructionStroke('residential', 12, city.size, { x: 10, z: 10 });
  stroke.update({ x: 12, z: 12 });
  const preview = previewBuild(city, stroke.points, 'residential');
  assert.equal(preview.count, 8);
  assert.deepEqual(preview.invalid, [{ x: 11, z: 11 }]);
  const money = city.money, result = build(city, stroke.points, 'residential');
  assert.ok(result.ok, result.message);
  assert.equal(result.count, preview.count);
  assert.equal(result.cost, preview.cost);
  assert.equal(city.money, money - preview.cost);
  assert.equal(city.tiles[11 * city.size + 11].kind, 'road');
});

test('only a primary press begins a pointer interaction and another pointer cannot replace it', () => {
  const interaction = new PointerInteraction();
  assert.equal(interaction.begin(1, 2), false);
  assert.equal(interaction.begin(1, 1), false);
  assert.equal(interaction.active, false);
  assert.equal(interaction.begin(7, 0), true);
  assert.equal(interaction.begin(8, 0), false);
  assert.equal(interaction.pointerId, 7);
  assert.equal(interaction.owns(7), true);
  assert.equal(interaction.owns(8), false);
});

test('foreign pointers and a right-button release cannot commit the active left-button stroke', () => {
  const interaction = new PointerInteraction();
  interaction.begin(7, 0);
  assert.equal(interaction.movement(8, 0), 'ignore');
  assert.equal(interaction.release(8, 0, true), 'ignore');
  assert.equal(interaction.release(7, 2, true), 'ignore');
  assert.equal(interaction.active, true);
  assert.equal(interaction.release(7, 0, true), 'commit');
  assert.equal(interaction.active, false);
  assert.equal(interaction.release(7, 0, true), 'ignore', 'A release can commit only once');
});

test('right-click or Escape cancellation consumes the stroke before a later left-button release', () => {
  const interaction = new PointerInteraction();
  interaction.begin(7, 0);
  assert.equal(interaction.cancel(), 7);
  assert.equal(interaction.pointerId, null);
  assert.equal(interaction.active, false);
  assert.equal(interaction.release(7, 0, true), 'ignore');
  assert.equal(interaction.cancel(), null);
  assert.equal(interaction.begin(7, 0), true, 'Construction can resume immediately after cancelling');
  assert.equal(interaction.release(7, 0, true), 'commit');
});

for (const buttons of [0, 2, 3]) {
  test(`pointer movement with buttons=${buttons} requests cancellation without losing the capture owner`, () => {
    const interaction = new PointerInteraction();
    interaction.begin(7, 0);
    assert.equal(interaction.movement(7, 1), 'continue');
    assert.equal(interaction.movement(7, buttons), 'cancel');
    assert.equal(interaction.pointerId, 7, 'The caller still needs the owner to release pointer capture');
    assert.equal(interaction.cancel(), 7);
    assert.equal(interaction.release(7, 0, true), 'ignore');
  });
}

test('releasing outside the map or over a blocking modal cancels and permits a fresh interaction', () => {
  const interaction = new PointerInteraction();
  interaction.begin(7, 0);
  assert.equal(interaction.release(7, 0, false), 'cancel');
  assert.equal(interaction.active, false);
  assert.equal(interaction.release(7, 0, true), 'ignore');
  assert.equal(interaction.begin(8, 0), true);
  assert.equal(interaction.release(8, 0, true), 'commit');
});
