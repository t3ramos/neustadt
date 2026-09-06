import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { createTileModel } from '../../src/rendering/buildings/models.ts';
import { sampleRoadHeight, warpRoadModel } from '../../src/rendering/infrastructure/roads.ts';
import { buildTerrainChunk, sampleGroundHeight } from '../../src/rendering/world/terrain.ts';
import type { CityState, Tile } from '../../src/domain/types.ts';

function city(): CityState {
  const state = createCity(3851, true, 40);
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.elevation = 2;
  }
  return state;
}
function transport(
  state: CityState,
  x: number,
  z: number,
  elevation: number,
  kind: 'road' | 'rail' = 'road',
): Tile {
  const tile = state.tiles[z * state.size + x];
  tile.kind = kind;
  tile.elevation = elevation;
  return tile;
}
function modelFor(state: CityState, tile: Tile): THREE.Group {
  const model = createTileModel(tile, state);
  warpRoadModel(model, tile, state);
  model.position.set(
    tile.x - state.size / 2 + 0.5,
    Math.max(0, tile.elevation),
    tile.z - state.size / 2 + 0.5,
  );
  model.updateMatrixWorld(true);
  return model;
}
function rayHeight(model: THREE.Object3D, x: number, z: number): number {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(model, true)[0];
  assert.ok(hit, `Missing road surface at ${x},${z}`);
  return hit.point.y;
}
function disposeModels(...groups: THREE.Object3D[]): void {
  for (const group of groups)
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
}

test('adjacent hilly road decks meet continuously without height steps', (t) => {
  const state = city(),
    models = new THREE.Group();
  for (let x = 8; x <= 13; x++) transport(state, x, 10, 1 + (x - 8) * 0.5);
  for (let x = 8; x <= 13; x++) models.add(modelFor(state, state.tiles[10 * state.size + x]));
  t.after(() => disposeModels(models));
  models.updateMatrixWorld(true);
  for (let x = 9; x <= 13; x++)
    for (const lateral of [-0.21, 0.19]) {
      const worldX = x - state.size / 2,
        worldZ = 10.5 + lateral - state.size / 2;
      const before = sampleRoadHeight(state, worldX - 1e-6, worldZ),
        after = sampleRoadHeight(state, worldX + 1e-6, worldZ);
      assert.ok(
        Math.abs(before - after) < 0.00001,
        'Connected deck samples must meet at each tile boundary',
      );
      assert.ok(
        Math.abs(
          rayHeight(models, worldX - 1e-6, worldZ) - rayHeight(models, worldX + 1e-6, worldZ),
        ) < 0.00001,
        'Actual asphalt geometry must also meet',
      );
    }
});

test('warping clones shared primitives, preserves UV/material groups, and can be repeated without accumulating offsets', (t) => {
  const state = city(),
    tile = transport(state, 10, 10, 2);
  transport(state, 11, 10, 2.5);
  transport(state, 10, 11, 1.5);
  const model = createTileModel(tile, state),
    other = createTileModel(tile, state);
  const mesh = model.children[0] as THREE.Mesh,
    otherMesh = other.children[0] as THREE.Mesh;
  assert.equal(mesh.geometry, otherMesh.geometry, 'Model primitives are shared before deformation');
  const original = mesh.geometry,
    positions = Array.from(original.getAttribute('position').array),
    groups = original.groups.map((g) => ({ ...g }));
  warpRoadModel(model, tile, state);
  t.after(() => disposeModels(model));
  assert.notEqual(mesh.geometry, original);
  assert.equal(otherMesh.geometry, original);
  assert.deepEqual(
    Array.from(original.getAttribute('position').array),
    positions,
    'Warping must not alter the shared primitive',
  );
  assert.deepEqual(original.groups, groups);
  assert.equal(mesh.geometry.groups.length, original.groups.length);
  assert.equal(
    mesh.geometry.getAttribute('uv').count,
    mesh.geometry.getAttribute('position').count,
  );
  assert.equal(
    mesh.geometry.getAttribute('normal').count,
    mesh.geometry.getAttribute('position').count,
  );
  assert.ok(Array.from(mesh.geometry.getAttribute('normal').array).every(Number.isFinite));
  assert.deepEqual(
    mesh.geometry.groups.map((g) => g.materialIndex),
    groups.map((g) => g.materialIndex),
  );
  const once = Array.from(mesh.geometry.getAttribute('position').array);
  warpRoadModel(model, tile, state);
  assert.deepEqual(
    Array.from(mesh.geometry.getAttribute('position').array),
    once,
    'Repeated application must use the untouched source geometry',
  );
});

test('asphalt and markings follow the exact triangle surface through a nonplanar intersection', (t) => {
  const state = city(),
    tile = transport(state, 10, 10, 2);
  transport(state, 9, 10, 1);
  transport(state, 11, 10, 3);
  transport(state, 10, 9, 1.5);
  transport(state, 10, 11, 2.5);
  transport(state, 9, 9, 0.5);
  transport(state, 11, 11, 4);
  const model = modelFor(state, tile);
  t.after(() => disposeModels(model));
  // The center asphalt slab crosses the terrain diagonal. Its top is .033 + .025/2.
  for (const u of [-0.26, -0.12, 0.08, 0.25])
    for (const v of [-0.27, -0.09, 0.11, 0.24]) {
      const x = tile.x + 0.5 + u - state.size / 2,
        z = tile.z + 0.5 + v - state.size / 2;
      const expected = sampleRoadHeight(state, x, z) + 0.0455;
      assert.ok(
        Math.abs(rayHeight(model, x, z) - expected) < 0.00001,
        `Asphalt must not float or cut through the diagonal at ${u},${v}`,
      );
    }
  // Painted pixels belong to the asphalt itself, with no extra marking geometry.
  const x = tile.x + 0.5 + 0.065 - state.size / 2,
    z = tile.z + 0.5 - 0.36 - state.size / 2;
  assert.ok(Math.abs(rayHeight(model, x, z) - (sampleRoadHeight(state, x, z) + 0.0455)) < 0.00001);
});

test('coastal bridges keep a continuous nonnegative deck while preserving submerged terrain', (t) => {
  const state = city(),
    models = new THREE.Group();
  for (const tile of state.tiles)
    if (tile.x >= 11) {
      tile.elevation = -2;
      tile.kind = 'water';
    }
  const tiles = [
    transport(state, 9, 10, 1),
    transport(state, 10, 10, 0.5),
    transport(state, 11, 10, -1),
    transport(state, 12, 10, -2),
    transport(state, 13, 10, -2),
  ];
  tiles.forEach((tile) => models.add(modelFor(state, tile)));
  t.after(() => disposeModels(models));
  models.updateMatrixWorld(true);
  for (let i = 0; i <= 150; i++) {
    const x = 9.2 + (i / 150) * 4.6 - state.size / 2,
      z = 10.64 - state.size / 2;
    const height = sampleRoadHeight(state, x, z);
    assert.ok(
      Number.isFinite(height) && height >= 0,
      'Bridge profile must be finite and above water',
    );
    assert.ok(Math.abs(rayHeight(models, x, z) - (height + 0.0455)) < 0.00001);
  }
  const bridgeX = 12.5 - state.size / 2,
    bridgeZ = 10.5 - state.size / 2;
  assert.equal(sampleRoadHeight(state, bridgeX, bridgeZ), 0);
  assert.ok(
    sampleGroundHeight(state, bridgeX, bridgeZ) < -1,
    'Bridge-only terrain must remain seabed rather than become a causeway',
  );
});

test('road ground uses the deck profile while civic foundations retain their exact level', (t) => {
  const state = city();
  for (let x = 8; x <= 13; x++) transport(state, x, 10, 1 + (x - 8) * 0.5);
  const civic = state.tiles[12 * state.size + 10];
  civic.kind = 'hospital';
  civic.elevation = 4;
  const material = new THREE.MeshStandardMaterial();
  const terrain = buildTerrainChunk(state, 8, 8, 8, {
    ground: material,
    earth: material,
    rock: material,
  });
  t.after(() => {
    disposeModels(terrain);
    material.dispose();
  });
  terrain.updateMatrixWorld(true);
  for (let x = 8; x <= 13; x++)
    for (const offset of [0.1, 0.5, 0.9]) {
      const wx = x + offset - state.size / 2,
        wz = 10.37 - state.size / 2;
      assert.ok(
        Math.abs(sampleGroundHeight(state, wx, wz) - sampleRoadHeight(state, wx, wz)) < 0.00001,
      );
      assert.ok(Math.abs(rayHeight(terrain, wx, wz) - sampleRoadHeight(state, wx, wz)) < 0.00001);
    }
  assert.equal(sampleGroundHeight(state, 10.5 - state.size / 2, 12.5 - state.size / 2), 4);
});

test('rotated rails keep their world orientation and follow continuous hills', (t) => {
  const state = city(),
    tiles = [
      transport(state, 9, 10, 1, 'rail'),
      transport(state, 10, 10, 1.5, 'rail'),
      transport(state, 11, 10, 2, 'rail'),
    ];
  const model = modelFor(state, tiles[1]);
  t.after(() => disposeModels(model));
  assert.equal(model.rotation.y, Math.PI / 2);
  for (const along of [-0.42, -0.15, 0.08, 0.37]) {
    // Local rail x = -.125 becomes world z = +.125 after the root rotates 90 degrees.
    const x = 10.5 + along - state.size / 2,
      z = 10.5 + 0.125 - state.size / 2;
    assert.ok(
      Math.abs(rayHeight(model, x, z) - (sampleRoadHeight(state, x, z) + 0.0925)) < 0.00001,
    );
  }
});

const bendDirections = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

test('rounded elbows carry both traffic lanes and wheel footprints over actual sloping asphalt in all rotations', async (t) => {
  const { lanePose } = await import('../../src/traffic/lanes.ts');
  const { roadBendPoint } = await import('../../src/rendering/infrastructure/roads.ts');
  const { roadPaintAt } = await import('../../src/rendering/infrastructure/road-surface.ts');
  for (let rotation = 0; rotation < 4; rotation++) {
    const state = city(),
      tile = transport(state, 10, 10, 2);
    const a = bendDirections[rotation],
      b = bendDirections[(rotation + 1) % 4];
    const previous = transport(state, 10 + a.x, 10 + a.z, 1.6);
    const next = transport(state, 10 + b.x, 10 + b.z, 2.4);
    const model = modelFor(state, tile);
    t.after(() => disposeModels(model));
    const asphalt = model.children.filter((child) => child.userData.roadSurface);
    assert.equal(asphalt.length, 1, 'The bend is one ribbon, not overlapping square slabs');
    assert.equal(asphalt[0].name, 'road-rounded-bend');
    for (const [from, to] of [
      [previous, next],
      [next, previous],
    ])
      for (let i = 1; i < 80; i++) {
        const pose = lanePose(from, tile, to, i / 80);
        for (const wheelOffset of [-0.065, 0, 0.065]) {
          const x = pose.x - state.size / 2 - pose.tangentZ * wheelOffset;
          const z = pose.z - state.size / 2 + pose.tangentX * wheelOffset;
          const ray = new THREE.Raycaster(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObjects(asphalt)[0];
          assert.ok(hit, `Wheel leaves asphalt in rotation ${rotation}, progress ${i}/80`);
          assert.ok(Math.abs(hit.point.y - sampleRoadHeight(state, x, z) - 0.0455) < 1e-5);
        }
      }
    const mask = (1 << rotation) | (1 << ((rotation + 1) % 4));
    const p = roadBendPoint(mask, 0.04);
    assert.equal(roadPaintAt(p.x, p.z, mask), 'line', 'Centre paint follows the rounded curve');
    const excluded = { x: -(a.x + b.x) * 0.29, z: -(a.z + b.z) * 0.29 };
    const ray = new THREE.Raycaster(
      new THREE.Vector3(10.5 - state.size / 2 + excluded.x, 30, 10.5 - state.size / 2 + excluded.z),
      new THREE.Vector3(0, -1, 0),
    );
    assert.equal(
      ray.intersectObjects(asphalt).length,
      0,
      'The old square outer corner must be removed',
    );
  }
});

test('connected grade smoothing reduces sharp terrain spikes and shares the exact supported ground profile', (t) => {
  const state = city(),
    models = new THREE.Group();
  for (let x = 5; x <= 15; x++) transport(state, x, 10, x === 10 ? 4 : 1);
  for (let x = 5; x <= 15; x++) models.add(modelFor(state, state.tiles[10 * state.size + x]));
  models.updateMatrixWorld(true);
  t.after(() => disposeModels(models));
  const heights = Array.from({ length: 11 }, (_, i) =>
    sampleRoadHeight(state, i + 5.5 - state.size / 2, 10.5 - state.size / 2),
  );
  assert.ok(
    Math.max(...heights) < 2,
    'An isolated 4-unit terrain peak is spread along the connected approach',
  );
  assert.ok(Math.max(...heights.slice(1).map((h, i) => Math.abs(h - heights[i]))) < 0.6);
  for (let i = 0; i <= 100; i++) {
    const x = 5.2 + i * 0.098 - state.size / 2,
      z = 10.66 - state.size / 2;
    assert.ok(Math.abs(rayHeight(models, x, z) - sampleGroundHeight(state, x, z) - 0.0455) < 1e-5);
  }
});

test('road grade edits outside the old terrain halo invalidate the affected supported surface', async () => {
  const { terrainChunkSignature } = await import('../../src/rendering/world/terrain.ts');
  const { buildingChunkSignature } = await import('../../src/rendering/scene/building-chunks.ts');
  const state = city();
  for (let x = 5; x <= 12; x++) transport(state, x, 10, 1);
  const before = terrainChunkSignature(state, 8, 8, 4);
  const buildingBefore = buildingChunkSignature(state, 8, 8, 4);
  const height = sampleGroundHeight(state, 8 - state.size / 2, 10.5 - state.size / 2);
  state.tiles[10 * state.size + 5].elevation = 4;
  assert.notEqual(terrainChunkSignature(state, 8, 8, 4), before);
  assert.notEqual(buildingChunkSignature(state, 8, 8, 4), buildingBefore);
  assert.notEqual(sampleGroundHeight(state, 8 - state.size / 2, 10.5 - state.size / 2), height);
});
