import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createCity,
  recalculate,
  isBuildingAnchor,
  serializeCity,
  deserializeCity,
  build,
  getFootprint,
  tick,
  triggerDisaster,
} from '../../src/simulation/city-simulation.ts';
import { claimZoneLot, syncZoneLot } from '../../src/buildings/lots.ts';
import {
  getRuralityField,
  isRuralCommercial,
  shouldAssignRuralCommercial,
} from '../../src/world/rural.ts';
import { buildRuralCommercial } from '../../src/rendering/buildings/rural.ts';
import { generateNewYorkCity } from '../../src/world/scenarios.ts';
import {
  captureConstructionState,
  recordConstruction,
  undoConstruction,
} from '../../src/construction/history.ts';
import { buildLandscapeChunk } from '../../src/rendering/world/landscape.ts';
function dispose(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
}
function farmSetup(assign = true) {
  const city = createCity(91, true, 40);
  for (const t of city.tiles) Object.assign(t, { kind: 'empty', elevation: 0 });
  const home = city.tiles[3 * 40 + 3];
  Object.assign(home, { kind: 'residential', level: 1 });
  const farm = city.tiles[20 * 40 + 25];
  for (let z = 20; z < 22; z++)
    for (let x = 25; x < 28; x++)
      Object.assign(city.tiles[z * 40 + x], { kind: 'commercial', level: 0, variation: 4 });
  assert.ok(claimZoneLot(city, farm, [3, 2]));
  farm.level = 1;
  if (assign) farm.ruralCommercial = shouldAssignRuralCommercial(city, farm);
  syncZoneLot(city, farm);
  recalculate(city);
  return { city, home, farm };
}

test('rural commercial uses a cached housing distance transform and keeps an established farm stable', () => {
  const { city, home, farm } = farmSetup(),
    field = getRuralityField(city);
  assert.equal(field.distance[farm.z * 40 + farm.x], 39);
  assert.ok(isRuralCommercial(city, farm));
  city.month++;
  recalculate(city);
  assert.equal(
    getRuralityField(city),
    field,
    'Unchanged housing footprint reuses distance transform',
  );
  home.level = 3;
  recalculate(city);
  assert.equal(getRuralityField(city), field, 'Housing density is not a topology change');
  Object.assign(city.tiles[20 * 40 + 24], { kind: 'residential', level: 1 });
  recalculate(city);
  assert.notEqual(getRuralityField(city), field);
  assert.equal(getRuralityField(city).distance[20 * 40 + 25], 1);
  farm.level = 4;
  syncZoneLot(city, farm);
  assert.ok(
    isRuralCommercial(city, farm),
    'Existing farms do not turn into office towers as the town reaches them',
  );
  const loaded = deserializeCity(serializeCity(city));
  assert.ok(isRuralCommercial(loaded, loaded.tiles[farm.z * 40 + farm.x]));
  const before = JSON.stringify(loaded.tiles);
  isRuralCommercial(loaded, loaded.tiles[farm.z * 40 + farm.x]);
  assert.equal(JSON.stringify(loaded.tiles), before, 'Renderer predicate never mutates saves');
  const { city: near, farm: nearFarm } = farmSetup(false);
  Object.assign(near.tiles[20 * 40 + 24], { kind: 'residential', level: 1 });
  recalculate(near);
  assert.equal(shouldAssignRuralCommercial(near, nearFarm), false);
  assert.equal(isRuralCommercial(near, nearFarm), false);
  const { city: special, farm: egg } = farmSetup();
  egg.variation = 900005;
  assert.equal(isRuralCommercial(special, egg), false);
});

test('rural building variants remain inside 4/6-tile parcels and batch animals', () => {
  const { farm } = farmSetup();
  for (const [w, d] of [
    [2, 2],
    [3, 2],
    [2, 3],
  ])
    for (let variation = 0; variation < 5; variation++) {
      const model = buildRuralCommercial({ ...farm, lotWidth: w, lotDepth: d, variation });
      try {
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        assert.ok(
          bounds.min.x >= -0.501 && bounds.max.x <= w - 0.499,
          `${w}x${d} variant${variation} x bounds`,
        );
        assert.ok(
          bounds.min.z >= -0.501 && bounds.max.z <= d - 0.499,
          `${w}x${d} variant${variation} z bounds`,
        );
        const herd = model.children.filter((o) => o.name.startsWith('livestock-'));
        assert.equal(herd.length, 3);
        assert.ok(herd.every((o) => o instanceof THREE.InstancedMesh));
        assert.ok(model.userData.animalCount >= 2);
        assert.ok(model.children.length < 25, 'Bounded meshes per farm');
      } finally {
        dispose(model);
      }
    }
});

test('Kassel has a served agricultural fringe, meadow relief and deterministic bounded lowland decoration', () => {
  const city = generateNewYorkCity(),
    farms = city.tiles.filter((t) => isBuildingAnchor(city, t) && isRuralCommercial(city, t));
  assert.ok(farms.length >= 6);
  assert.ok(farms.every((t) => t.x < 22 && t.connected && t.powered && t.watered));
  const fringe = city.tiles.filter((t) => t.x <= 21 && t.x > 3 && t.z > 47 && t.kind === 'empty');
  assert.ok(fringe.length > 350);
  assert.ok(fringe.some((t) => t.elevation > 0));
  const loaded = deserializeCity(serializeCity(city));
  assert.equal(
    loaded.tiles.filter((t) => isBuildingAnchor(loaded, t) && isRuralCommercial(loaded, t)).length,
    farms.length,
  );
  let grass = 0,
    flowers = 0,
    rocks = 0;
  for (let z = 0; z < city.size; z += 16) {
    const chunk = buildLandscapeChunk(city, 0, z, 16);
    try {
      grass += chunk.userData.grassCount;
      flowers += chunk.userData.flowerCount;
      rocks += chunk.userData.rockCount;
      assert.ok(chunk.children.length <= 6);
      assert.ok(chunk.userData.grassCount <= 16 * 16 * 3);
    } finally {
      dispose(chunk);
    }
  }
  assert.ok(grass > 300);
  assert.ok(flowers > 5);
  assert.ok(rocks > 10, 'Lowland formations appear without mountains');
  const first = buildLandscapeChunk(city, 80, 0, 16),
    second = buildLandscapeChunk(city, 80, 0, 16);
  try {
    assert.deepEqual(
      first.children.map((o) => (o as THREE.InstancedMesh).instanceMatrix.array),
      second.children.map((o) => (o as THREE.InstancedMesh).instanceMatrix.array),
    );
  } finally {
    dispose(first);
    dispose(second);
  }
  const small = createCity(12, true, 40),
    start = buildLandscapeChunk(small, 15, 15, 7);
  try {
    assert.equal(start.userData.grassCount, 0);
    assert.equal(start.userData.rockCount, 0);
  } finally {
    dispose(start);
  }
});

test('farm flags validate strictly, preserve legacy absence and survive demolition undo', () => {
  const { city, farm } = farmSetup(),
    raw = serializeCity(city),
    index = farm.z * 40 + farm.x;
  for (const mutation of ['type', 'kind', 'dimensions', 'partial', 'easterEgg']) {
    const changed = JSON.parse(raw);
    if (mutation === 'type') changed.tiles[index].ruralCommercial = 'yes';
    if (mutation === 'kind') changed.tiles[index].kind = 'residential';
    if (mutation === 'dimensions') {
      changed.tiles[index].lotWidth = 2;
      changed.tiles[index].lotDepth = 1;
    }
    if (mutation === 'partial') delete changed.tiles[index + 1].ruralCommercial;
    if (mutation === 'easterEgg') changed.tiles[index].variation = 900005;
    assert.throws(() => deserializeCity(JSON.stringify(changed)), Error, mutation);
  }
  const legacy = JSON.parse(raw);
  for (const t of legacy.tiles) delete t.ruralCommercial;
  const loadedLegacy = deserializeCity(JSON.stringify(legacy));
  assert.equal(loadedLegacy.tiles[index].ruralCommercial, undefined);
  assert.equal(isRuralCommercial(loadedLegacy, loadedLegacy.tiles[index]), false);
  const before = captureConstructionState(city),
    history: Parameters<typeof undoConstruction>[1] = [];
  const removed = build(city, [{ x: farm.x + 1, z: farm.z + 1 }], 'bulldoze');
  assert.ok(removed.ok);
  recordConstruction(history, before, city, 'bulldoze', removed);
  for (let z = 20; z < 22; z++)
    for (let x = 25; x < 28; x++) assert.equal(city.tiles[z * 40 + x].ruralCommercial, undefined);
  assert.ok(undoConstruction(city, history).ok);
  assert.ok(isRuralCommercial(city, farm));
  assert.equal(deserializeCity(serializeCity(city)).tiles[index].ruralCommercial, true);
  city.settings.disastersEnabled = true;
  assert.ok(triggerDisaster(city, 'earthquake').ok);
  for (const t of city.tiles) if (t.kind === 'rubble') assert.equal(t.ruralCommercial, undefined);
});

test('first simulation growth assigns a saved farm and zoning undo owns the whole grown parcel', () => {
  const city = generateNewYorkCity();
  city.tax = 0;
  recalculate(city);
  const points = [];
  for (let z = 112; z < 114; z++)
    for (let x = 8; x < 11; x++) {
      points.push({ x, z });
      Object.assign(city.tiles[z * city.size + x], { kind: 'empty', elevation: 0 });
    }
  // Open country needs a real feeder; only enclosed street blocks auto-distribute power.
  for (let z = 112; z <= 114; z++)
    Object.assign(city.tiles[z * city.size + 10], { hasPowerLine: true, hasPipe: true });
  const before = captureConstructionState(city),
    history: Parameters<typeof undoConstruction>[1] = [];
  const built = build(city, points, 'commercial');
  assert.ok(built.ok);
  // Deterministic parcel variant selected before the recorded zoning snapshot.
  for (const p of points) {
    const t = city.tiles[p.z * city.size + p.x];
    t.variation = 4;
    t.age = 10;
  }
  recordConstruction(history, before, city, 'commercial', built);
  let farm = city.tiles[112 * city.size + 8];
  for (let step = 0; step < 40 && farm.level === 0; step++) {
    for (const p of points)
      if (p.x !== farm.x || p.z !== farm.z) city.tiles[p.z * city.size + p.x].age = 0;
    tick(city);
  }
  assert.ok(farm.level > 0);
  assert.equal(getFootprint(city, farm).length, 6);
  assert.equal(farm.ruralCommercial, true);
  farm.level = 4;
  syncZoneLot(city, farm);
  Object.assign(city.tiles[114 * city.size + 10], { kind: 'residential', level: 1 });
  recalculate(city);
  const loaded = deserializeCity(serializeCity(city));
  assert.ok(isRuralCommercial(loaded, loaded.tiles[112 * city.size + 8]));
  assert.ok(undoConstruction(city, history).ok);
  for (const p of points) {
    const t = city.tiles[p.z * city.size + p.x];
    assert.equal(t.ruralCommercial, undefined);
    assert.ok(t.kind === 'empty' || t.kind === 'tree');
  }
});
