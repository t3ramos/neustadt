import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createTileModel } from '../../src/rendering/buildings/models';
import { createCity } from '../../src/simulation/city-simulation';
import { commercialMedium } from '../../src/rendering/buildings/architecture';
import {
  addFourSidedOpenings,
  facadeBoxGeometry,
} from '../../src/rendering/buildings/facade-openings';
import { box } from '../../src/rendering/buildings/primitives';
import type { Tile, TileKind } from '../../src/domain/types';

function assertVisibleOpeningOnEverySide(model: THREE.Group, label: string): void {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model),
    center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const ray = new THREE.Raycaster();
  for (const [axis, sign] of [
    ['x', 1],
    ['x', -1],
    ['z', 1],
    ['z', -1],
  ] as const) {
    let opening = false;
    for (let row = 1; row <= 9 && !opening; row++)
      for (let column = 1; column <= 9; column++) {
        const origin = center.clone();
        origin[axis] += sign * (size[axis] + 2);
        origin.y = bounds.min.y + (size.y * row) / 11;
        const lateral = axis === 'x' ? 'z' : 'x';
        origin[lateral] = bounds.min[lateral] + (size[lateral] * column) / 10;
        const direction = new THREE.Vector3();
        direction[axis] = -sign;
        ray.set(origin, direction);
        const hit = ray.intersectObject(model, true)[0];
        if (!hit || !(hit.object instanceof THREE.Mesh)) continue;
        const material = hit.object.material as THREE.MeshStandardMaterial;
        if (
          material.userData.glazing ||
          material.userData.fourSidedOpenings ||
          material.userData.facadeTexture
        ) {
          opening = true;
          break;
        }
      }
    assert.ok(
      opening,
      `${label} has no visible window facade facing ${sign > 0 ? '+' : '-'}${axis}`,
    );
  }
}

test('all five medium offices expose openings on four sides with distinct low-rise massing', () => {
  const materials = new Set<string>(),
    silhouettes = new Set<string>();
  for (let variation = 0; variation < 5; variation++)
    for (const [w, d] of [
      [1, 1],
      [2, 2],
      [3, 2],
      [2, 3],
    ]) {
      const model = new THREE.Group();
      commercialMedium(model, { variation, level: 2, lotWidth: w, lotDepth: d } as Tile);
      assertVisibleOpeningOnEverySide(model, `medium family ${variation}`);
      const bounds = new THREE.Box3().setFromObject(model);
      assert.ok(
        bounds.min.x >= -0.5 &&
          bounds.max.x <= w - 0.5 &&
          bounds.min.z >= -0.5 &&
          bounds.max.z <= d - 0.5,
      );
      let count = 0;
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          count++;
          const material = child.material as THREE.MeshStandardMaterial;
          if (material.userData.facadeTexture) materials.add(material.name);
        }
      });
      assert.ok(count <= 17, 'medium offices stay under their small mesh budget');
      if (w === 1 && d === 1) silhouettes.add(`${count}:${bounds.max.y}`);
    }
  assert.equal(materials.size, 5);
  assert.equal(silhouettes.size, 5);
});

test('residential, factory and civic shells no longer expose entirely blank cardinal facades', () => {
  const state = createCity(81, true, 40);
  for (const [kind, level] of [
    ['residential', 1],
    ['residential', 2],
    ['residential', 3],
    ['industrial', 3],
    ['school', 1],
    ['hospital', 1],
    ['police', 1],
    ['fire', 1],
    ['university', 1],
    ['power', 1],
    ['waterpump', 1],
    ['airport', 1],
    ['recycling', 1],
  ] as [TileKind, number][]) {
    const tile = {
      ...state.tiles[12 * state.size + 12],
      kind,
      level,
      variation: 0,
      x: 12,
      z: 12,
      anchor: -1,
      lotWidth: undefined,
      lotDepth: undefined,
      rotation: 0,
    } as Tile;
    assertVisibleOpeningOnEverySide(createTileModel(tile, state), kind);
  }
});

test('opening treatment reuses geometry, leaves footprint unchanged and keeps top faces unpainted', () => {
  const group = new THREE.Group();
  box(group, 0xe4d9bf, 0, 0.5, 0, 0.8, 1, 0.7);
  const before = new THREE.Box3().setFromObject(group);
  addFourSidedOpenings(group);
  assert.deepEqual(new THREE.Box3().setFromObject(group), before);
  assert.equal(group.children.length, 1);
  assert.equal((group.children[0] as THREE.Mesh).geometry, facadeBoxGeometry);
  const uv = facadeBoxGeometry.getAttribute('uv');
  for (let vertex = 8; vertex < 16; vertex++)
    assert.ok(Math.abs(uv.getX(vertex) - 0.01) < 1e-7 && Math.abs(uv.getY(vertex) - 0.01) < 1e-7);
});

test('seaport warehouse has windows on all sides while cargo containers remain windowless', () => {
  const state = createCity(81, true, 40);
  const tile = {
    ...state.tiles[12 * state.size + 12],
    kind: 'seaport',
    level: 1,
    variation: 0,
    x: 12,
    z: 12,
    anchor: -1,
    rotation: 0,
  } as Tile;
  const model = createTileModel(tile, state),
    warehouse = new THREE.Group();
  let cargo = 0;
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child.userData.noFacadeOpenings) {
      cargo++;
      assert.equal(child.userData.fourSidedOpenings, undefined);
    }
    if (child.userData.fourSidedOpenings) warehouse.add(child.clone());
  });
  assert.ok(cargo >= 6, 'shipping containers must be excluded from inhabited wall treatment');
  assert.ok(warehouse.children.length > 0);
  // Cargo legitimately obscures some outer sightlines, so test the occupied
  // warehouse itself while independently asserting untouched cargo above.
  assertVisibleOpeningOnEverySide(warehouse, 'seaport warehouse');
});
