import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { createTileModel, getModelFootprint } from '../../src/rendering/buildings/models.ts';
import { FACILITY_FOOTPRINTS } from '../../src/rendering/buildings/facility-frame.ts';
import {
  preloadEasterEggBuilding,
  disposeEasterEggBuildingAssets,
  EASTER_EGG_BUILDING_VARIATION,
} from '../../src/rendering/buildings/easter-egg.ts';
import {
  createDrivingCollisionWorld,
  extractDrivingCollisionShapes,
  collisionShapeIntersects,
} from '../../src/vehicles/collisions.ts';
import { getPowerLayout } from '../../src/infrastructure/power-layout.ts';
import { powerServiceModelPlacement } from '../../src/rendering/infrastructure/power.ts';
import type { TileKind } from '../../src/domain/types.ts';

function fixture(
  kind: TileKind,
  variation = 0,
  rotation: 0 | 1 | 2 | 3 = 0,
  level = 1,
  rural = false,
) {
  const state = createCity(917, true, 40);
  for (const tile of state.tiles)
    Object.assign(tile, {
      kind: 'empty',
      elevation: 0,
      level: 0,
      anchor: -1,
      hasPipe: false,
      hasPowerLine: false,
    });
  const anchor = 15 * state.size + 15;
  const [width, depth] = rural ? [2, 2] : getModelFootprint(kind, rotation);
  for (let z = 15; z < 15 + depth; z++)
    for (let x = 15; x < 15 + width; x++)
      Object.assign(state.tiles[z * state.size + x], {
        kind,
        variation,
        rotation,
        level,
        anchor,
        ...(rural ? { lotWidth: width, lotDepth: depth, ruralCommercial: true } : {}),
      });
  state.revision++;
  const tile = state.tiles[anchor];
  const model = createTileModel(tile, state);
  model.position.set(-4.5, 0, -4.5);
  model.updateMatrixWorld(true);
  return { state, tile, model, world: createDrivingCollisionWorld(state) };
}

// Independent oracle: shoot horizontal rays against the actual renderer meshes,
// then require physical body-height hits to block in the collision world.
function assertRenderedWalls(f: ReturnType<typeof fixture>, label: string) {
  let checked = 0;
  f.model.traverseVisible((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      object instanceof THREE.InstancedMesh ||
      object.userData.buildingWindowLight ||
      object.userData.drivingSurface
    )
      return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.min.y > 0.12 || bounds.max.y < 0.18) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(
      new THREE.Vector3(bounds.min.x - 0.1, 0.12, center.z),
      new THREE.Vector3(1, 0, 0),
    );
    const hit = ray.intersectObject(object, false)[0];
    if (!hit) return;
    assert.equal(
      f.world.pointBlocked(hit.point.x + 0.0001, hit.point.z, 0.025),
      true,
      `${label}: visible ${object.name || object.geometry.type} at ${hit.point.toArray()}`,
    );
    checked++;
  });
  assert.ok(checked > 0, `${label}: oracle must sample a real body-height obstacle`);
  f.world.dispose();
}

test('rendered walls and physical props collide across every RCI level, variant and rotation', () => {
  for (const kind of ['residential', 'commercial', 'industrial'] as const)
    for (const level of [1, 2, 3, 4])
      for (let variant = 0; variant < 5; variant++)
        for (const rotation of [0, 1, 2, 3] as const)
          assertRenderedWalls(
            fixture(kind, variant, rotation, level),
            `${kind}/${level}/${variant}/${rotation}`,
          );
});

test('civic facilities and furnished parks retain obstacles while open meadows stay traversable', () => {
  for (const kind of Object.keys(FACILITY_FOOTPRINTS) as TileKind[])
    for (const rotation of [0, 1, 2, 3] as const)
      assertRenderedWalls(fixture(kind, 0, rotation), `${kind}/${rotation}`);
  for (const kind of ['park', 'beach'] as const)
    for (let variant = 0; variant < 5; variant++) {
      if (kind === 'beach' && variant === 1) continue; // Only towels and a low ball.
      if (kind === 'park' && variant === 3) {
        const meadow = fixture(kind, variant);
        assert.ok(new THREE.Box3().setFromObject(meadow.model).max.y < 0.12);
        for (const x of [-0.4, -0.2, 0, 0.2, 0.4])
          for (const z of [-0.4, -0.2, 0, 0.2, 0.4])
            assert.equal(
              meadow.world.pointBlocked(-4.5 + x, -4.5 + z, 0.025),
              false,
              'flat meadow has no hidden former planter collision',
            );
        meadow.world.dispose();
        continue;
      }
      assertRenderedWalls(fixture(kind, variant), `${kind}/${variant}`);
    }
});

test('park bench seats and pasture rails are obstacles, not surfaces which raise a car over them', () => {
  const park = fixture('park', 2);
  assert.ok(park.world.surfaceHeight(-4.5, -4.7, 0) < 0.075);
  assert.equal(park.world.pointBlocked(-4.5, -4.7), true, 'Seat center, between its legs');
  assert.equal(park.world.pointBlocked(-4.5, -4.2), false, 'Open pergola path stays open');
  const rural = fixture('commercial', 0, 0, 1, true);
  assert.ok(rural.world.surfaceHeight(-4.38, -3.96, 0) < 0.075);
  assert.equal(rural.world.pointBlocked(-4.38, -3.96), true, 'Pasture rail between posts');
});

test('instanced obstacles use each transformed instance and never create a phantom source cube', () => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    2,
  );
  const transform = new THREE.Object3D();
  for (let i = 0; i < 2; i++) {
    transform.position.set(i ? 2 : -2, 0.2, 0);
    transform.scale.set(0.16, 0.3, 0.12);
    transform.rotation.y = Math.PI / 4;
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  }
  const root = new THREE.Group();
  root.position.set(1, 0, 2);
  root.add(mesh);
  const shapes = extractDrivingCollisionShapes(root);
  const blocked = (x: number, z: number) =>
    shapes.some((s) => collisionShapeIntersects(s, x, z, 0));
  assert.equal(blocked(-1, 2), true);
  assert.equal(blocked(3, 2), true);
  assert.equal(blocked(1, 2), false);
});

test('low volumetric fountain rims and beach balls remain solid above the ground', () => {
  const fountain = fixture('park', 1);
  assert.equal(fountain.world.pointBlocked(-4.25, -4.5), true, 'Low circular fountain rim');
  const beach = fixture('beach', 1);
  assert.equal(beach.world.pointBlocked(-4.18, -4.8), true, 'Rendered beach ball');
  assert.equal(beach.world.pointBlocked(-4.5, -4.47), false, 'Flat beach towel');
});

test('worker array replacement retains unchanged geometry and tile queries resolve anchors', () => {
  const f = fixture('park', 2);
  const before = f.world.getShapesNear(-4.5, -4.5, 0);
  const next = { ...f.state, tiles: f.state.tiles.map((tile) => ({ ...tile })) };
  f.world.setState(next);
  const after = f.world.getShapesNear(-4.5, -4.5, 0);
  assert.equal(after[0], before[0], 'No mesh extraction for unchanged worker snapshots');
  assert.ok(f.world.tileCollides(615, -4.5, -4.7, 0, undefined, 0.028));
  const airport = fixture('airport');
  const direct = airport.world.getShapesNear(-0.5, -0.5, 0);
  assert.ok(direct.length > 0, 'Follower tile resolves the far-away airport anchor');
  const shape = direct.find((s) => !s.surface && s.minY < 0.1 && s.maxY > 0.5)!;
  assert.ok(shape);
  assert.ok(
    airport.world.tileCollides(
      616,
      (shape.minX + shape.maxX) / 2,
      (shape.minZ + shape.maxZ) / 2,
      0,
    ),
  );
});

test('rural livestock blocks at its rendered position for all variants and cache follows parcel character', () => {
  for (let variant = 0; variant < 5; variant++) {
    const f = fixture('commercial', variant, 0, 1, true);
    assertRenderedWalls(f, `farm/${variant}`);
    assert.equal(f.world.pointBlocked(-4.73, -3.76), true, 'Actual livestock body');
  }
  const f = fixture('commercial', 0, 0, 1, true);
  assert.equal(f.world.pointBlocked(-4.73, -3.76), true);
  f.tile.ruralCommercial = false;
  const normal = createDrivingCollisionWorld(f.state);
  assert.equal(
    f.world.pointBlocked(-4.73, -3.76),
    normal.pointBlocked(-4.73, -3.76),
    'In-place parcel character update invalidates mesh cache',
  );
});

test('power poles and service cabinets block, open ground under spans remains clear, demolition invalidates', () => {
  const f = fixture('power');
  for (let x = 10; x < 15; x++) f.state.tiles[15 * f.state.size + x].hasPowerLine = true;
  f.state.revision++;
  const layout = getPowerLayout(f.state);
  assert.ok(layout.poles.length > 1);
  for (const pole of layout.poles) {
    assert.equal(f.world.pointBlocked(pole.x - 19.5, pole.z - 19.5, pole.elevation + 0.03), true);
  }
  assert.equal(f.world.pointBlocked(-8, -4.5), false, 'Ground between two poles');
  assert.ok(layout.services.length > 0);
  for (const service of layout.services) {
    const pole = layout.poles.find((p) => p.id === service.pole)!;
    const placement = powerServiceModelPlacement(
      f.state,
      service,
      new THREE.Vector3(pole.x - 19.5, pole.elevation, pole.z - 19.5),
    );
    assert.equal(
      f.world.pointBlocked(placement.cabinet.x, placement.cabinet.z, placement.cabinet.y + 0.03),
      true,
    );
  }
  for (const tile of f.state.tiles) tile.hasPowerLine = false;
  f.state.revision++;
  assert.equal(f.world.pointBlocked(-9.5, -4.5), false);
});

test('shipping Easter Egg GLB walls collide in every rotation', async (t) => {
  const bytes = await readFile(
    new URL('../../public/assets/models/easter-egg-office.glb', import.meta.url),
  );
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'collision-test-texture',
    loadTexture: async () => new THREE.Texture(),
  }));
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => gltf);
  await preloadEasterEggBuilding();
  t.after(() => disposeEasterEggBuildingAssets());
  for (const rotation of [0, 1, 2, 3] as const) {
    const f = fixture('commercial', EASTER_EGG_BUILDING_VARIATION, rotation);
    const [w, d] = rotation % 2 ? [2, 3] : [3, 2];
    for (let z = 15; z < 15 + d; z++)
      for (let x = 15; x < 15 + w; x++)
        Object.assign(f.state.tiles[z * 40 + x], {
          kind: 'commercial',
          level: 1,
          anchor: 615,
          lotWidth: w,
          lotDepth: d,
          variation: EASTER_EGG_BUILDING_VARIATION,
          rotation,
        });
    f.model = createTileModel(f.tile, f.state);
    f.model.position.set(-4.5, 0, -4.5);
    f.model.updateMatrixWorld(true);
    assertRenderedWalls(f, `Easter Egg/${rotation}`);
  }
});
