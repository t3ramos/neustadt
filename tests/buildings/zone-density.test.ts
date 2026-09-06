import assert from 'node:assert/strict';
import test from 'node:test';
import {
  effectiveZoneDensity,
  zoneDensityCap,
  ZONE_DENSITIES,
} from '../../src/buildings/density.ts';
import { claimZoneLot, syncZoneLot } from '../../src/buildings/lots.ts';
import {
  createCity,
  build,
  previewBuild,
  serializeCity,
  deserializeCity,
  tick,
} from '../../src/simulation/city-simulation.ts';
import {
  captureConstructionState,
  recordConstruction,
  undoConstruction,
} from '../../src/construction/history.ts';
import { clearTile, destroyBuilding } from '../../src/simulation/tile-operations.ts';
import { generateNewYorkCity } from '../../src/world/scenarios.ts';

function setup() {
  const city = createCity(81, true, 40);
  for (const t of city.tiles) Object.assign(t, { kind: 'empty', elevation: 0 });
  const points = [
    { x: 12, z: 12 },
    { x: 13, z: 12 },
    { x: 12, z: 13 },
    { x: 13, z: 13 },
  ];
  const root = city.tiles[12 * 40 + 12];
  return { city, points, root };
}

test('density boundaries block atomic lot claims for every zone; legacy means high', () => {
  assert.equal(effectiveZoneDensity({}), 'high');
  assert.equal(zoneDensityCap({}), 4);
  for (const kind of ['residential', 'commercial', 'industrial'] as const) {
    const { city, points, root } = setup();
    assert.ok(build(city, points, kind, { density: 'low' }).ok);
    city.tiles[12 * 40 + 13].zoneDensity = 'medium';
    assert.equal(claimZoneLot(city, root, [2, 2]), false);
    assert.ok(points.every((p) => city.tiles[p.z * 40 + p.x].anchor === -1));
    city.tiles[12 * 40 + 13].zoneDensity = 'low';
    assert.ok(claimZoneLot(city, root, [2, 2]));
    root.level = 1;
    syncZoneLot(city, root);
    assert.ok(points.every((p) => city.tiles[p.z * 40 + p.x].zoneDensity === 'low'));
  }
});

test('child density rezone previews, charges, clears and undoes the complete linked building', () => {
  const { city, points, root } = setup();
  assert.ok(build(city, points, 'residential', { density: 'high' }).ok);
  assert.ok(claimZoneLot(city, root, [2, 2]));
  root.level = 4;
  syncZoneLot(city, root);
  const loaded = deserializeCity(serializeCity(city));
  assert.equal(loaded.tiles[root.z * 40 + root.x].zoneDensity, 'high');
  const before = captureConstructionState(city),
    history: Parameters<typeof undoConstruction>[1] = [];
  const preview = previewBuild(city, [points[3]], 'residential', { density: 'low' });
  assert.equal(preview.valid.length, 4);
  assert.equal(preview.count, 4);
  assert.match(preview.message, /Stufe 0|level 0/);
  const result = build(city, [points[3]], 'residential', { density: 'low' });
  assert.ok(result.ok);
  assert.equal(result.cost, preview.cost);
  assert.equal(result.count, preview.count);
  assert.ok(
    points.every((p) => {
      const t = city.tiles[p.z * 40 + p.x];
      return t.zoneDensity === 'low' && t.level === 0 && t.anchor === -1;
    }),
  );
  assert.ok(recordConstruction(history, before, city, 'residential', result));
  assert.ok(undoConstruction(city, history).ok);
  assert.ok(
    points.every((p) => {
      const t = city.tiles[p.z * 40 + p.x];
      return t.zoneDensity === 'high' && t.level === 4 && t.anchor === root.z * 40 + root.x;
    }),
  );
  deserializeCity(serializeCity(city));
  destroyBuilding(city, root);
  assert.ok(points.every((p) => city.tiles[p.z * 40 + p.x].zoneDensity === undefined));
  root.zoneDensity = 'low';
  clearTile(root);
  assert.equal(root.zoneDensity, undefined);
});

test('save validation rejects invalid density, cap violations and mixed linked density but retains legacy saves', () => {
  const { city, points, root } = setup();
  build(city, points, 'commercial', { density: 'high' });
  claimZoneLot(city, root, [2, 2]);
  root.level = 1;
  syncZoneLot(city, root);
  const saved = serializeCity(city);
  for (const value of ['maximum', null, 3, 'medium']) {
    const data = JSON.parse(saved);
    data.tiles[13 * 40 + 13].zoneDensity = value;
    assert.throws(() => deserializeCity(JSON.stringify(data)), /density|inconsistent zone/);
  }
  const capped = JSON.parse(saved);
  for (const p of points)
    Object.assign(capped.tiles[p.z * 40 + p.x], { zoneDensity: 'low', level: 2 });
  assert.throws(() => deserializeCity(JSON.stringify(capped)), /density/);
  const legacy = JSON.parse(saved);
  for (const t of legacy.tiles) delete t.zoneDensity;
  const restored = deserializeCity(JSON.stringify(legacy));
  assert.equal(effectiveZoneDensity(restored.tiles[12 * 40 + 12]), 'high');
});

test('New York retains three fixed density districts per zone, farms and caps over ten calendar months', () => {
  const city = generateNewYorkCity();
  const zoned = city.tiles.filter((t) =>
    ['residential', 'commercial', 'industrial'].includes(t.kind),
  );
  const density = zoned.map((t) => t.zoneDensity);
  for (const kind of ['residential', 'commercial', 'industrial'])
    for (const d of ZONE_DENSITIES)
      assert.ok(
        zoned.some((t) => t.kind === kind && t.zoneDensity === d && t.level === zoneDensityCap(t)),
        `${kind} ${d} starts at its cap`,
      );
  const farms = zoned.filter(
    (t) =>
      t.kind === 'commercial' &&
      t.zoneDensity === 'low' &&
      t.ruralCommercial &&
      (t.lotWidth ?? 1) * (t.lotDepth ?? 1) >= 4,
  );
  assert.ok(farms.length > 0);
  for (let step = 0; step < 120; step++) {
    tick(city);
    assert.ok(zoned.every((t) => t.level <= zoneDensityCap(t)));
  }
  assert.deepEqual(
    zoned.map((t) => t.zoneDensity),
    density,
  );
  assert.ok(farms.every((t) => t.ruralCommercial && t.level <= 1));
  deserializeCity(serializeCity(city));
});
