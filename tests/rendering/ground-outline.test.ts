import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../../src/simulation/city-simulation';
import {
  createGroundOutline,
  groundOutlineHeight,
  selectionBounds,
} from '../../src/rendering/scene/ground-outline';
import { createTileModel, getModelFootprint } from '../../src/rendering/buildings/models';
import { FACILITY_FOOTPRINTS } from '../../src/rendering/buildings/facility-frame';
import { boxGeometry } from '../../src/rendering/buildings/primitives';
import { getFacilityAccess, sampleFacilityAccessHeight } from '../../src/buildings/facility-access';
import type { TileKind } from '../../src/domain/types';
import { sampleGroundHeight } from '../../src/rendering/world/terrain';

function fixture() {
  const state = createCity(81, true, 40);
  for (const tile of state.tiles)
    Object.assign(tile, { kind: 'empty', level: 0, elevation: 0, anchor: -1 });
  return state;
}

test('selection resolves child cells and retains rectangular facility axes in all rotations', () => {
  for (const rotation of [0, 1, 2, 3] as const) {
    const state = fixture();
    const [width, depth] = getModelFootprint('fire', rotation);
    const index = 12 * state.size + 11;
    for (let z = 12; z < 12 + depth; z++)
      for (let x = 11; x < 11 + width; x++)
        Object.assign(state.tiles[z * state.size + x], {
          kind: 'fire',
          anchor: index,
          rotation,
          elevation: 1.5,
          level: 1,
        });
    const bounds = selectionBounds(state, { x: 11 + width - 1, z: 12 + depth - 1 })!;
    assert.deepEqual(bounds, { x: 11, z: 12, width, depth });
    const geometry = createGroundOutline(state, bounds);
    const box = geometry.boundingBox!;
    assert.ok(Math.abs(box.min.x - (11 - 20 + 0.055)) < 1e-6);
    assert.ok(Math.abs(box.max.x - (11 - 20 + width - 0.055)) < 1e-6);
    assert.ok(Math.abs(box.min.z - (12 - 20 + 0.055)) < 1e-6);
    assert.ok(Math.abs(box.max.z - (12 - 20 + depth - 0.055)) < 1e-6);
    assert.ok(
      Math.abs(box.min.y - 1.576) < 1e-5,
      'outer edge follows the actual .07 plinth plus .006 bias',
    );
    assert.ok(
      Math.abs(box.max.y - 1.589) < 1e-5,
      'inner edge follows the actual .083 surface without blanket lift',
    );
    assert.ok(
      geometry.getAttribute('position').count < 1800,
      'authored step boundaries avoid recursive geometry explosion',
    );
    geometry.dispose();
  }
});

function facilityFixture(kind: TileKind, rotation: 0 | 1 | 2 | 3, connected: boolean) {
  const state = fixture(),
    [width, depth] = getModelFootprint(kind, rotation);
  const x = 12,
    z = 12,
    index = z * state.size + x;
  for (let dz = 0; dz < depth; dz++)
    for (let dx = 0; dx < width; dx++)
      Object.assign(state.tiles[(z + dz) * state.size + x + dx], {
        kind,
        level: 1,
        rotation,
        anchor: index,
        elevation: 0.5,
      });
  if (connected)
    for (let dx = -1; dx <= width; dx++)
      Object.assign(state.tiles[(z + depth) * state.size + x + dx], {
        kind: 'road',
        level: 1,
        elevation: 0.5,
      });
  return { state, tile: state.tiles[index], bounds: { x, z, width, depth } };
}

test('all rotated connected and disconnected facilities follow authored low supports, including child picks', () => {
  for (const kind of Object.keys(FACILITY_FOOTPRINTS) as TileKind[])
    for (const rotation of [0, 1, 2, 3] as const)
      for (const connected of [false, true]) {
        const { state, tile, bounds } = facilityFixture(kind, rotation, connected);
        const plan = getFacilityAccess(state, tile)!;
        assert.equal(plan.connected, connected, `${kind}/${rotation} access fixture`);
        const selection = selectionBounds(state, {
          x: bounds.x + bounds.width - 1,
          z: bounds.z + bounds.depth - 1,
        });
        assert.deepEqual(selection, bounds);
        const model = createTileModel(tile, state);
        model.position.set(tile.x - state.size / 2 + 0.5, 0.5, tile.z - state.size / 2 + 0.5);
        model.updateMatrixWorld(true);
        const supports: THREE.Mesh[] = [];
        model.traverse((part) => {
          if (
            part instanceof THREE.Mesh &&
            !part.userData.fireRoof &&
            (part.userData.facilityFoundation || part.userData.drivingSurface)
          )
            supports.push(part);
        });
        const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
        // Independently hit the authored outer plinth and inner pavement in
        // the rendered model; a roof raycast would return much larger values.
        for (const offset of [0.055, 0.078])
          for (const [x, z] of [
            [tile.x - 20 + offset, tile.z - 20 + bounds.depth / 2],
            [tile.x - 20 + bounds.width - offset, tile.z - 20 + bounds.depth / 2],
            [tile.x - 20 + bounds.width / 2, tile.z - 20 + offset],
            [tile.x - 20 + bounds.width / 2, tile.z - 20 + bounds.depth - offset],
          ]) {
            ray.ray.origin.set(x, 2, z);
            const hit = ray.intersectObjects(supports, false)[0];
            const access = sampleFacilityAccessHeight(plan, x, z);
            const expected = Math.max(
              sampleGroundHeight(state, x, z),
              hit?.point.y ?? -Infinity,
              access ?? -Infinity,
            );
            const actual = groundOutlineHeight(state, x, z);
            assert.ok(
              Math.abs(actual - expected - 0.006) < 0.0015,
              `${kind}/${rotation}/${connected} buried or floating at ${x},${z}: ${actual} vs ${expected}`,
            );
          }
      }
});

function checkInteriors(
  state: ReturnType<typeof fixture>,
  geometry: THREE.BufferGeometry,
  stride = 1,
) {
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i += 3 * stride)
    for (const [a, b, c] of [
      [1 / 3, 1 / 3, 1 / 3],
      [0.8, 0.1, 0.1],
      [0.1, 0.8, 0.1],
      [0.1, 0.1, 0.8],
      [0.45, 0.45, 0.1],
      [0.1, 0.45, 0.45],
    ]) {
      const x = a * p.getX(i) + b * p.getX(i + 1) + c * p.getX(i + 2);
      const z = a * p.getZ(i) + b * p.getZ(i + 1) + c * p.getZ(i + 2);
      const y = a * p.getY(i) + b * p.getY(i + 1) + c * p.getY(i + 2);
      const expected = groundOutlineHeight(state, x, z);
      assert.ok(y >= expected - 0.00155, `triangle ${i / 3} buried: ${y} < ${expected}`);
      assert.ok(y <= expected + 0.0025, `triangle ${i / 3} floats: ${y} > ${expected}`);
    }
}

test('adaptive outline conforms between vertices at sloping terrain breakpoints and facility steps', () => {
  const state = fixture();
  for (const tile of state.tiles) tile.elevation = tile.x >= 15 ? 2.5 : tile.z >= 15 ? 1.5 : 0;
  const geometry = createGroundOutline(state, { x: 14, z: 14, width: 2, depth: 2 });
  checkInteriors(state, geometry);
  assert.ok(geometry.getAttribute('position').count < 16000);
  geometry.dispose();
  for (const rotation of [0, 1, 2, 3] as const) {
    const f = facilityFixture('fire', rotation, false);
    const outline = createGroundOutline(f.state, f.bounds);
    checkInteriors(f.state, outline);
    outline.dispose();
  }
});

test('support cache follows foundation edits and never disposes shared model geometry', () => {
  const f = facilityFixture('fire', 0, false);
  let disposed = false;
  const onDispose = () => {
    disposed = true;
  };
  boxGeometry.addEventListener('dispose', onDispose);
  try {
    const first = groundOutlineHeight(f.state, -7.922, -7);
    for (const tile of f.state.tiles) if (tile.anchor === f.tile.anchor) tile.elevation += 0.5;
    assert.ok(Math.abs(groundOutlineHeight(f.state, -7.922, -7) - first - 0.5) < 1e-6);
    createGroundOutline(f.state, f.bounds).dispose();
    assert.equal(disposed, false);
  } finally {
    boxGeometry.removeEventListener('dispose', onDispose);
  }
});

test('connected sloping access remains visible across triangle interiors in every rotation', () => {
  for (const rotation of [0, 1, 2, 3] as const) {
    const f = facilityFixture('fire', rotation, true);
    for (const tile of f.state.tiles) if (tile.kind === 'road') tile.elevation = 0.15;
    assert.equal(getFacilityAccess(f.state, f.tile)?.connected, true);
    const geometry = createGroundOutline(f.state, f.bounds);
    checkInteriors(f.state, geometry);
    assert.ok(
      geometry.getAttribute('position').count < 20000,
      'ramp refinement remains local and bounded',
    );
    geometry.dispose();
  }
});

test('saved non-square zone lots retain world axes for rotated child selections', () => {
  for (const rotation of [0, 1, 2, 3] as const) {
    const state = fixture(),
      index = 12 * state.size + 12;
    for (let z = 12; z < 15; z++)
      for (let x = 12; x < 14; x++)
        Object.assign(state.tiles[z * state.size + x], {
          kind: 'residential',
          level: 3,
          variation: 4,
          rotation,
          anchor: index,
          lotWidth: 2,
          lotDepth: 3,
        });
    const bounds = selectionBounds(state, { x: 13, z: 14 });
    assert.deepEqual(bounds, { x: 12, z: 12, width: 2, depth: 3 });
    const geometry = createGroundOutline(state, bounds!);
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - 1.89) < 1e-5 && Math.abs(size.z - 2.89) < 1e-5);
    geometry.dispose();
  }
});

test('outline conforms to varied terrain at every strip vertex and rebuilding follows earthworks', () => {
  const state = fixture();
  for (const tile of state.tiles)
    tile.elevation = (tile.x >= 15 ? 2 : 0) + (tile.z >= 15 ? 0.5 : 0);
  const bounds = { x: 14, z: 14, width: 2, depth: 2 };
  const geometry = createGroundOutline(state, bounds);
  const p = geometry.getAttribute('position');
  assert.ok(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y > 1);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    assert.ok(Math.abs(p.getY(i) - (sampleGroundHeight(state, x, z) + 0.006)) < 1e-5);
  }
  for (const tile of state.tiles) tile.elevation += 0.5;
  const rebuilt = createGroundOutline(state, bounds);
  assert.ok(Math.abs(rebuilt.boundingBox!.max.y - geometry.boundingBox!.max.y - 0.5) < 1e-5);
  geometry.dispose();
  rebuilt.dispose();
});

test('road and bridge markers remain above the deck; invalid picks produce no selection', () => {
  const state = fixture();
  Object.assign(state.tiles[14 * state.size + 14], { kind: 'road', elevation: -1 });
  assert.ok(groundOutlineHeight(state, -5.5, -5.5) >= 0.04);
  for (const point of [
    { x: -1, z: 2 },
    { x: 40, z: 2 },
    { x: 2.5, z: 2 },
  ])
    assert.equal(selectionBounds(state, point), null);
  const geometry = createGroundOutline(state, { x: 14, z: 14, width: 1, depth: 1 });
  const p = geometry.getAttribute('position');
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(center.x + 5.5) < 1e-6 && Math.abs(center.z + 5.5) < 1e-6);
  assert.ok(p.count <= 300, 'one selected tile has a small fixed tessellation budget');
  geometry.dispose();
});
