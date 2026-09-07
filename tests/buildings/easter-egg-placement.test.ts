import { relocateEasterEggToPark } from '../../src/buildings/easter-egg-relocation.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCity,
  recalculate,
  serializeCity,
  deserializeCity,
  build,
  tick,
} from '../../src/simulation/city-simulation.ts';
import {
  claimZoneLot,
  claimEasterEggLot,
  findEasterEggLotPlan,
  tryEarlyEasterEggLot,
  syncZoneLot,
  EASTER_EGG_BUILDING_VARIATION,
} from '../../src/buildings/lots.ts';
import { generateNewYorkCity } from '../../src/world/scenarios.ts';

function sites() {
  const city = createCity(61, true, 64);
  for (const t of city.tiles) Object.assign(t, { kind: 'empty', elevation: 0 });
  const roots = [6, 18, 30, 42].map((x) => city.tiles[12 * 64 + x]);
  for (const root of roots) {
    for (let z = 12; z < 14; z++)
      for (let x = root.x; x < root.x + 3; x++)
        Object.assign(city.tiles[z * 64 + x], {
          kind: 'commercial',
          zoneDensity: 'medium',
          variation: 4,
        });
    for (let x = root.x; x < root.x + 3; x++) city.tiles[14 * 64 + x].kind = 'road';
  }
  return { city, roots };
}

test('fourth suitable medium business opening becomes the landmark at rank zero, even across save/load', () => {
  const { city, roots } = sites();
  assert.equal(city.progression.rank, 0);
  for (const root of roots.slice(0, 3)) {
    assert.equal(tryEarlyEasterEggLot(city, root), false);
    assert.ok(claimZoneLot(city, root, [3, 2]));
    root.level = 1;
    syncZoneLot(city, root);
  }
  const loaded = deserializeCity(serializeCity(city));
  const fourth = loaded.tiles[roots[3].z * 64 + roots[3].x];
  const plan = findEasterEggLotPlan(loaded, fourth, true)!;
  assert.ok(plan.clearView && plan.clearView.length > 20);
  assert.equal(loaded.progression.counters.mediumCommercialLandmarkSites, 3);
  assert.ok(tryEarlyEasterEggLot(loaded, fourth));
  fourth.level = 2;
  syncZoneLot(loaded, fourth);
  assert.equal(fourth.zoneDensity, 'medium');
  assert.equal(fourth.rotation, 0);
  assert.equal(loaded.tiles.filter((t) => t.variation === EASTER_EGG_BUILDING_VARIATION).length, 6);
  assert.ok(
    plan.clearView.every((p) => ['park', 'road'].includes(loaded.tiles[p.z * 64 + p.x].kind)),
  );
  const reserved = plan.clearView.find((p) => loaded.tiles[p.z * 64 + p.x].kind === 'park')!;
  assert.equal(build(loaded, [reserved], 'residential', { density: 'high' }).ok, false);
  assert.equal(tryEarlyEasterEggLot(loaded, loaded.tiles[roots[0].z * 64 + roots[0].x]), false);
  deserializeCity(serializeCity(loaded));
});

test('high density and potentially obstructed frontages never count as early medium landmark sites', () => {
  const { city, roots } = sites();
  const root = roots[0];
  for (let z = 12; z < 14; z++)
    for (let x = root.x; x < root.x + 3; x++) city.tiles[z * 64 + x].zoneDensity = 'high';
  assert.equal(tryEarlyEasterEggLot(city, root), false);
  const other = roots[1];
  const plan = findEasterEggLotPlan(city, other, true)!;
  const p = plan.clearView!.at(-1)!;
  city.tiles[p.z * 64 + p.x].kind = 'residential';
  assert.equal(
    findEasterEggLotPlan(city, other, true),
    null,
    'even an undeveloped diagonal foreground zone could later obstruct the facade',
  );
  assert.equal(tryEarlyEasterEggLot(city, other), false);
  assert.equal(city.progression.counters.mediumCommercialLandmarkSites, undefined);
});

test('New York landmark faces street then Central Park and retains its open diagonal foreground', () => {
  const city = generateNewYorkCity();
  const root = city.tiles.find(
    (t) => t.variation === EASTER_EGG_BUILDING_VARIATION && t.anchor === t.z * city.size + t.x,
  )!;
  assert.equal(root.rotation, 0);
  assert.equal(root.zoneDensity, 'medium');
  assert.equal(root.level, 2);
  const foreground = [];
  for (let distance = 1; distance <= 5; distance++)
    for (let lateral = -distance; lateral < 3 + distance; lateral++)
      foreground.push(city.tiles[(root.z + 1 + distance) * city.size + root.x + lateral]);
  for (let x = root.x; x < root.x + 3; x++)
    assert.equal(city.tiles[(root.z + 2) * city.size + x].kind, 'road');
  assert.ok(foreground.every((t) => ['park', 'water', 'road'].includes(t.kind)));
  const initial = foreground.map((t) => t.kind);
  for (let step = 0; step < 120; step++) tick(city);
  assert.deepEqual(
    foreground.map((t) => t.kind),
    initial,
  );
  assert.ok(root.level <= 2);
  assert.equal(root.rotation, 0);
  deserializeCity(serializeCity(city));
});

test('explicit relocation returns an audited copy without replacing another occupied parcel', () => {
  const { city, roots } = sites();
  const old = roots[0],
    target = roots[3];
  assert.ok(claimEasterEggLot(city, old));
  old.level = 2;
  syncZoneLot(city, old);
  const plan = findEasterEggLotPlan(
    {
      ...city,
      tiles: city.tiles.map((t) =>
        t.variation === EASTER_EGG_BUILDING_VARIATION ? { ...t, variation: 4 } : t,
      ),
    },
    target,
    true,
  )!;
  for (const p of plan.clearView!)
    if (city.tiles[p.z * 64 + p.x].kind !== 'road')
      Object.assign(city.tiles[p.z * 64 + p.x], { kind: 'park', variation: 1 });
  for (let z = target.z; z < target.z + 2; z++)
    for (let x = target.x; x < target.x + 3; x++) {
      const t = city.tiles[z * 64 + x];
      t.kind = 'park';
      delete t.zoneDensity;
    }
  recalculate(city);
  const before = structuredClone(city);
  const moved = relocateEasterEggToPark(city, { x: target.x, z: target.z })!;
  assert.ok(moved);
  assert.deepEqual(city, before, 'the command is pure; the caller decides whether to apply it');
  assert.notDeepEqual(moved.from, moved.to);
  assert.deepEqual(moved.to, { x: target.x, z: target.z });
  assert.equal(relocateEasterEggToPark(city, { x: roots[1].x, z: roots[1].z }), null);
  assert.ok(moved.changedTiles.length >= 12);
  assert.equal(moved.city.money, city.money);
  assert.deepEqual(moved.city.progression, city.progression);
  assert.deepEqual(moved.city.settings, city.settings);
  assert.deepEqual(moved.city.history, city.history);
  for (const root of roots.slice(1, 3)) {
    const t = moved.city.tiles[root.z * 64 + root.x];
    assert.equal(t.kind, root.kind);
    assert.equal(t.zoneDensity, root.zoneDensity);
    assert.equal(t.variation, root.variation);
    assert.equal(t.level, root.level);
  }
  assert.ok(
    moved.city.tiles
      .filter((t) => t.variation === EASTER_EGG_BUILDING_VARIATION)
      .every((t) => t.zoneDensity === 'medium' && t.level === 2),
  );
  deserializeCity(serializeCity(moved.city));
});

test('explicit relocation fails without mutation when there is no safe park-front parcel', () => {
  const { city, roots } = sites();
  assert.ok(claimEasterEggLot(city, roots[0]));
  const before = structuredClone(city);
  assert.equal(relocateEasterEggToPark(city), null);
  assert.deepEqual(city, before);
});
