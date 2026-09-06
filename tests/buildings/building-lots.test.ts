import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createCity,
  build,
  getFootprint,
  recalculate,
  serializeCity,
  deserializeCity,
  triggerDisaster,
} from '../../src/simulation/city-simulation.ts';
import { getFacilityAccess } from '../../src/buildings/facility-access.ts';
import { createDrivingCollisionWorld } from '../../src/vehicles/collisions.ts';
import {
  EASTER_EGG_BUILDING_VARIATION,
  claimEasterEggLot,
  findEasterEggLotPlan,
  claimZoneLot,
  syncZoneLot,
} from '../../src/buildings/lots.ts';
import { createTileModel, getModelFootprint } from '../../src/rendering/buildings/models.ts';
import {
  captureConstructionState,
  recordConstruction,
  undoConstruction,
} from '../../src/construction/history.ts';
import type { Tile, TileKind } from '../../src/domain/types.ts';
function setup(kind: TileKind = 'commercial', w = 3, d = 2) {
  const city = createCity(81, true, 40);
  for (const t of city.tiles) {
    t.kind = 'empty';
    t.elevation = 0;
    t.hasPipe = false;
    t.hasPowerLine = false;
  }
  const anchor = city.tiles[12 * 40 + 12];
  for (let z = 12; z < 12 + d; z++)
    for (let x = 12; x < 12 + w; x++) Object.assign(city.tiles[z * 40 + x], { kind, variation: 4 });
  return { city, anchor };
}
test('2, 4 and 6 lot RCI claims are atomic and never replace a road, facility, developed neighbor or slope', () => {
  for (const kind of ['commercial', 'industrial'] as const)
    for (const [w, d] of [
      [2, 1],
      [2, 2],
      [3, 2],
    ]) {
      const { city, anchor } = setup(kind, w, d);
      assert.ok(claimZoneLot(city, anchor, [w, d]));
      anchor.level = 2;
      syncZoneLot(city, anchor);
      assert.equal(getFootprint(city, city.tiles[13 * 40 + 12]).length, d === 2 ? w * d : 1);
      assert.equal(getFootprint(city, anchor).length, w * d);
    }
  for (const obstruction of ['road', 'hospital', 'developed', 'slope']) {
    const { city, anchor } = setup();
    const other = city.tiles[12 * 40 + 13];
    if (obstruction === 'slope') other.elevation = 1;
    else if (obstruction === 'developed') other.level = 1;
    else other.kind = obstruction as TileKind;
    const before = JSON.stringify(city.tiles);
    assert.equal(claimZoneLot(city, anchor, [3, 2]), false);
    assert.equal(JSON.stringify(city.tiles), before);
  }
});
test('linked zone export/import, child bulldoze, undo and disaster preserve whole building membership', () => {
  const { city, anchor } = setup('residential', 2, 2);
  assert.ok(claimZoneLot(city, anchor, [2, 2]));
  anchor.level = 2;
  syncZoneLot(city, anchor);
  recalculate(city);
  assert.equal(city.stats.population, 112);
  const loaded = deserializeCity(serializeCity(city));
  assert.equal(getFootprint(loaded, loaded.tiles[13 * 40 + 13]).length, 4);
  const before = captureConstructionState(city),
    history: Parameters<typeof undoConstruction>[1] = [];
  const result = build(city, [{ x: 13, z: 13 }], 'bulldoze');
  assert.ok(result.ok);
  recordConstruction(history, before, city, 'bulldoze', result);
  assert.equal(city.stats.population, 0);
  assert.ok(undoConstruction(city, history).ok);
  assert.equal(city.stats.population, 112);
  assert.equal(getFootprint(city, anchor).length, 4);
  city.settings.disastersEnabled = true;
  assert.ok(triggerDisaster(city, 'earthquake').ok);
  for (const p of [
    { x: 12, z: 12 },
    { x: 13, z: 12 },
    { x: 12, z: 13 },
    { x: 13, z: 13 },
  ]) {
    const t = city.tiles[p.z * 40 + p.x];
    assert.equal(t.kind, 'rubble');
    assert.equal(t.anchor, -1);
    assert.equal(t.lotWidth, undefined);
  }
});
test('incomplete and mismatched zone links are rejected, legacy singleton saves remain valid', () => {
  const { city, anchor } = setup();
  assert.ok(claimZoneLot(city, anchor, [3, 2]));
  anchor.level = 1;
  syncZoneLot(city, anchor);
  recalculate(city);
  const parsed = JSON.parse(serializeCity(city));
  parsed.tiles[13 * 40 + 14].anchor = -1;
  delete parsed.tiles[13 * 40 + 14].lotWidth;
  delete parsed.tiles[13 * 40 + 14].lotDepth;
  assert.throws(() => deserializeCity(JSON.stringify(parsed)), /incomplete|Unvollständiges/i);
  const legacy = setup();
  legacy.anchor.level = 1;
  recalculate(legacy.city);
  assert.equal(deserializeCity(serializeCity(legacy.city)).tiles[12 * 40 + 12].lotWidth, undefined);
});
test('every RCI and facility kind has five structurally different variants within its lot', () => {
  const { city, anchor } = setup();
  const kinds: TileKind[] = [
    'residential',
    'commercial',
    'industrial',
    'power',
    'waterpump',
    'police',
    'fire',
    'hospital',
    'school',
    'university',
    'stadium',
    'airport',
    'seaport',
    'wind',
    'solar',
    'recycling',
    'park',
  ];
  for (const kind of kinds) {
    const signatures = new Set<string>();
    for (let variation = 0; variation < 5; variation++) {
      const model = createTileModel({ ...anchor, kind, level: 1, variation, anchor: -1 }, city),
        parts: string[] = [];
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh && !obj.userData.buildingWindowLight)
          parts.push(
            [
              obj.geometry.type,
              ...obj.position.toArray(),
              ...obj.scale.toArray(),
              ...obj.rotation.toArray(),
            ].join(','),
          );
      });
      signatures.add(parts.join(';'));
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model),
        [w, d] = getModelFootprint(kind);
      assert.ok(
        bounds.min.x >= -0.501 && bounds.max.x <= w - 0.499,
        `${kind} variant ${variation} width`,
      );
      assert.ok(
        bounds.min.z >= -0.501 && bounds.max.z <= d - 0.499,
        `${kind} variant ${variation} depth`,
      );
    }
    assert.equal(signatures.size, 5, kind);
  }
  for (const kind of ['residential', 'commercial', 'industrial'] as const) {
    const model = createTileModel(
      { ...anchor, kind, level: 2, variation: 4, anchor: 12 * 40 + 12, lotWidth: 3, lotDepth: 2 },
      city,
    );
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    assert.ok(bounds.min.x >= -0.501 && bounds.max.x <= 2.501);
    assert.ok(bounds.min.z >= -0.501 && bounds.max.z <= 1.501);
  }
});

test('industrial multi-lot driveways use the full parcel and clear actual rendered walls', () => {
  for (const [w, d] of [
    [2, 1],
    [2, 2],
    [3, 2],
  ])
    for (const side of ['south', 'east', 'north', 'west']) {
      const { city, anchor } = setup('industrial', w, d);
      assert.ok(claimZoneLot(city, anchor, [w, d]));
      anchor.level = 2;
      syncZoneLot(city, anchor);
      const roadX = side === 'east' ? 12 + w : side === 'west' ? 11 : 12;
      const roadZ = side === 'south' ? 12 + d : side === 'north' ? 11 : 12;
      const dx = side === 'east' ? 1 : side === 'west' ? -1 : 0,
        dz = side === 'south' ? 1 : side === 'north' ? -1 : 0;
      for (let i = 0; i < 3; i++) city.tiles[(roadZ + dz * i) * 40 + roadX + dx * i].kind = 'road';
      const plan = getFacilityAccess(city, anchor);
      assert.ok(plan?.connected);
      assert.equal(plan.width, w);
      assert.equal(plan.depth, d);
      const world = createDrivingCollisionWorld(city);
      for (const p of plan.points)
        assert.equal(
          world.pointBlocked(p.x, p.z, p.y + 0.1),
          false,
          `${w}x${d} ${side} ${p.x},${p.z}`,
        );
      const model = createTileModel(anchor, city);
      let paving = 0;
      model.traverse((o) => {
        if (o.name === 'facility-access-paving') paving++;
      });
      assert.ok(paving >= 4);
      world.dispose();
    }
});

test('undo of zoned rectangle survives whole-lot growth without clearing neighboring development', () => {
  const { city, anchor } = setup();
  for (const t of city.tiles) t.kind = 'empty';
  const before = captureConstructionState(city),
    history: Parameters<typeof undoConstruction>[1] = [];
  const points = [];
  for (let z = 12; z < 14; z++) for (let x = 12; x < 15; x++) points.push({ x, z });
  const built = build(city, points, 'residential');
  assert.ok(built.ok);
  recordConstruction(history, before, city, 'residential', built);
  assert.ok(claimZoneLot(city, anchor, [3, 2]));
  anchor.level = 2;
  syncZoneLot(city, anchor);
  recalculate(city);
  const neighbor = city.tiles[12 * 40 + 15];
  neighbor.kind = 'residential';
  neighbor.level = 2;
  assert.ok(undoConstruction(city, history).ok);
  assert.equal(neighbor.level, 2);
  for (const p of points) {
    const t = city.tiles[p.z * 40 + p.x];
    assert.equal(t.kind, 'empty');
    assert.equal(t.anchor, -1);
    assert.equal(t.lotWidth, undefined);
  }
});

test('unique Easter Egg business plans real street frontage in all four directions and survives saves', () => {
  for (const rotation of [0, 1, 2, 3] as const) {
    const w = rotation % 2 ? 2 : 3,
      d = rotation % 2 ? 3 : 2,
      { city, anchor } = setup('commercial', w, d);
    const x = rotation === 1 ? 11 : rotation === 3 ? 12 + w : 13,
      z = rotation === 0 ? 12 + d : rotation === 2 ? 11 : 13;
    city.tiles[z * 40 + x].kind = 'road';
    const plan = findEasterEggLotPlan(city, anchor);
    assert.equal(plan?.rotation, rotation);
    assert.equal(plan?.width, w);
    assert.equal(plan?.depth, d);
    assert.ok(claimEasterEggLot(city, anchor));
    anchor.level = 4;
    syncZoneLot(city, anchor);
    recalculate(city);
    assert.equal(city.tiles.filter((t) => t.variation === EASTER_EGG_BUILDING_VARIATION).length, 6);
    const saved = deserializeCity(serializeCity(city));
    assert.equal(saved.tiles[anchor.anchor].rotation, rotation);
    for (let zz = 22; zz < 24; zz++)
      for (let xx = 22; xx < 25; xx++) city.tiles[zz * 40 + xx].kind = 'commercial';
    city.tiles[24 * 40 + 23].kind = 'road';
    assert.equal(claimEasterEggLot(city, city.tiles[22 * 40 + 22]), false);
  }
});
test('EASTER_EGG import rejects duplicate or malformed reserved markers and demolition undo enforces uniqueness', () => {
  const { city, anchor } = setup();
  city.tiles[14 * 40 + 13].kind = 'road';
  assert.ok(claimEasterEggLot(city, anchor));
  anchor.level = 3;
  syncZoneLot(city, anchor);
  recalculate(city);
  const corrupt = JSON.parse(serializeCity(city));
  corrupt.tiles[20 * 40 + 20].variation = EASTER_EGG_BUILDING_VARIATION;
  assert.throws(() => deserializeCity(JSON.stringify(corrupt)), /Easter[- _]?Egg/i);
  const malformed = JSON.parse(serializeCity(city));
  malformed.tiles[anchor.anchor].rotation = 1;
  assert.throws(() => deserializeCity(JSON.stringify(malformed)), /Easter[- _]?Egg/i);
  const before = captureConstructionState(city),
    history: Parameters<typeof undoConstruction>[1] = [];
  const result = build(city, [{ x: 14, z: 13 }], 'bulldoze');
  assert.ok(result.ok);
  recordConstruction(history, before, city, 'bulldoze', result);
  assert.equal(city.tiles.filter((t) => t.variation === EASTER_EGG_BUILDING_VARIATION).length, 0);
  assert.ok(undoConstruction(city, history).ok);
  assert.equal(city.tiles.filter((t) => t.variation === EASTER_EGG_BUILDING_VARIATION).length, 6);
  const beforeAgain = captureConstructionState(city),
    demolished = build(city, [{ x: 12, z: 12 }], 'bulldoze');
  recordConstruction(history, beforeAgain, city, 'bulldoze', demolished);
  for (let z = 22; z < 24; z++)
    for (let x = 22; x < 25; x++) city.tiles[z * 40 + x].kind = 'commercial';
  city.tiles[24 * 40 + 23].kind = 'road';
  assert.ok(claimEasterEggLot(city, city.tiles[22 * 40 + 22]));
  city.tiles[22 * 40 + 22].level = 1;
  syncZoneLot(city, city.tiles[22 * 40 + 22]);
  assert.equal(undoConstruction(city, history).ok, false);
  assert.equal(city.tiles.filter((t) => t.variation === EASTER_EGG_BUILDING_VARIATION).length, 6);
});

test('zoning and utility undo survive EASTER_EGG growth toward all four road directions', () => {
  for (const rotation of [0, 1, 2, 3] as const)
    for (const tool of ['commercial', 'pipe', 'powerline'] as const) {
      const w = rotation % 2 ? 2 : 3,
        d = rotation % 2 ? 3 : 2,
        { city, anchor } = setup('commercial', w, d);
      const points = [];
      for (let z = 12; z < 12 + d; z++) for (let x = 12; x < 12 + w; x++) points.push({ x, z });
      if (tool === 'commercial') for (const p of points) city.tiles[p.z * 40 + p.x].kind = 'empty';
      const roadX = rotation === 1 ? 11 : rotation === 3 ? 12 + w : 13,
        roadZ = rotation === 0 ? 12 + d : rotation === 2 ? 11 : 13;
      city.tiles[roadZ * 40 + roadX].kind = 'road';
      const before = captureConstructionState(city),
        history: Parameters<typeof undoConstruction>[1] = [];
      const result = build(city, tool === 'commercial' ? points : [points[0]], tool);
      assert.ok(result.ok);
      assert.ok(recordConstruction(history, before, city, tool, result));
      assert.ok(claimEasterEggLot(city, anchor));
      anchor.level = 3;
      syncZoneLot(city, anchor);
      recalculate(city);
      assert.equal(anchor.rotation, rotation);
      const grown = points.map((p) => ({ ...city.tiles[p.z * 40 + p.x] })),
        money = city.money;
      assert.ok(undoConstruction(city, history).ok, `${tool} facing ${rotation}`);
      assert.equal(city.money, money + result.cost);
      assert.equal(city.tiles[roadZ * 40 + roadX].kind, 'road');
      if (tool === 'commercial')
        for (const p of points) {
          const tile = city.tiles[p.z * 40 + p.x];
          assert.equal(tile.kind, 'empty');
          assert.equal(tile.anchor, -1);
          assert.equal(tile.rotation, 0);
        }
      else
        for (let i = 0; i < points.length; i++) {
          const tile: Tile = city.tiles[points[i].z * 40 + points[i].x];
          for (const key of [
            'kind',
            'level',
            'anchor',
            'rotation',
            'variation',
            'lotWidth',
            'lotDepth',
          ] as const)
            assert.equal(tile[key], grown[i][key]);
        }
      assert.equal(city.tiles[12 * 40 + 12].hasPipe, false);
      assert.equal(city.tiles[12 * 40 + 12].hasPowerLine, false);
    }
});
test('growth rotation exception rejects partial zoning ownership and arbitrary non-growth rotation edits', () => {
  for (const rotation of [0, 1, 2, 3] as const) {
    const w = rotation % 2 ? 2 : 3,
      d = rotation % 2 ? 3 : 2,
      { city, anchor } = setup('commercial', w, d);
    anchor.kind = 'empty';
    const roadX = rotation === 1 ? 11 : rotation === 3 ? 12 + w : 13,
      roadZ = rotation === 0 ? 12 + d : rotation === 2 ? 11 : 13;
    city.tiles[roadZ * 40 + roadX].kind = 'road';
    const before = captureConstructionState(city),
      history: Parameters<typeof undoConstruction>[1] = [],
      result = build(city, [{ x: 12, z: 12 }], 'commercial');
    recordConstruction(history, before, city, 'commercial', result);
    assert.ok(claimEasterEggLot(city, anchor));
    anchor.level = 3;
    syncZoneLot(city, anchor);
    recalculate(city);
    const unchanged = JSON.stringify(city);
    assert.equal(undoConstruction(city, history).ok, false);
    assert.equal(JSON.stringify(city), unchanged);
  }
  for (const tool of ['commercial', 'pipe', 'powerline'] as const) {
    const { city, anchor } = setup();
    if (tool === 'commercial') anchor.kind = 'empty';
    const before = captureConstructionState(city),
      history: Parameters<typeof undoConstruction>[1] = [],
      result = build(city, [{ x: 12, z: 12 }], tool);
    recordConstruction(history, before, city, tool, result);
    anchor.rotation = 1;
    const unchanged = JSON.stringify(city);
    assert.equal(undoConstruction(city, history).ok, false);
    assert.equal(JSON.stringify(city), unchanged);
  }
});
