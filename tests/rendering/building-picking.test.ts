import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  batchGroup,
  batchGroupSteps,
  disposeGroup,
  getBatchTriangleOwner,
} from '../../src/rendering/scene/geometry';
import { createBuildingChunks } from '../../src/rendering/scene/building-chunks';
import { createCity } from '../../src/simulation/city-simulation';

function cast(root: THREE.Object3D, x: number, z: number): THREE.Intersection {
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(root, true)[0];
  assert.ok(hit, `expected a surface at ${x},${z}`);
  return hit;
}

test('material batching preserves adjacent building owners when an overhang crosses a parcel boundary', () => {
  const source = new THREE.Group(),
    material = new THREE.MeshBasicMaterial();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  for (const [anchor, x, y, width, height] of [
    [100, 0.5, 2, 1.8, 0.2],
    [101, 1.5, 0.5, 0.8, 1],
  ]) {
    const building = new THREE.Group();
    building.userData.pickAnchor = anchor;
    const body = new THREE.Mesh(geometry, material);
    body.position.set(x, y, 0.5);
    body.scale.set(width, height, 0.8);
    building.add(body);
    source.add(building);
  }
  const batch = batchGroup(source);
  try {
    assert.equal(batch.children.length, 1, 'same material remains one draw call');
    const overhang = cast(batch, 1.2, 0.5),
      neighbour = cast(batch, 1.7, 0.5);
    assert.equal(Math.floor(overhang.point.x), 1, 'geometric flooring would select the neighbour');
    assert.equal(getBatchTriangleOwner(overhang.object, overhang.faceIndex), 100);
    assert.equal(getBatchTriangleOwner(neighbour.object, neighbour.faceIndex), 101);
    assert.deepEqual(Object.keys((batch.children[0] as THREE.Mesh).geometry.attributes).sort(), [
      'normal',
      'position',
      'uv',
    ]);
    assert.equal((batch.children[0] as THREE.Mesh).geometry.groups.length, 0);
  } finally {
    disposeGroup(batch);
    geometry.dispose();
    material.dispose();
  }
});

test('nested translated, rotated and scaled meshes inherit their nearest tagged ancestor', () => {
  const source = new THREE.Group(),
    material = new THREE.MeshBasicMaterial();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  source.position.set(2, 0, -3);
  source.rotation.y = Math.PI / 2;
  const building = new THREE.Group();
  building.userData.pickAnchor = 12;
  building.position.set(3, 0, 2);
  building.scale.set(1.4, 1, 0.8);
  const inherited = new THREE.Mesh(geometry, material);
  inherited.position.set(-1, 1, 0);
  const wing = new THREE.Group();
  wing.userData.pickAnchor = 19;
  wing.position.set(1, 0, 0);
  wing.rotation.y = Math.PI / 4;
  const overridden = new THREE.Mesh(geometry, material);
  overridden.position.y = 1;
  wing.add(overridden);
  building.add(inherited, wing);
  source.add(building);
  source.updateMatrixWorld(true);
  const points = [inherited, overridden].map((mesh) => mesh.getWorldPosition(new THREE.Vector3()));
  const batch = batchGroup(source);
  try {
    for (const [i, anchor] of [12, 19].entries()) {
      const hit = cast(batch, points[i].x, points[i].z);
      assert.equal(getBatchTriangleOwner(hit.object, hit.faceIndex), anchor);
    }
  } finally {
    disposeGroup(batch);
    geometry.dispose();
    material.dispose();
  }
});

test('face ranges are local to each material, include index expansion and leave unowned gaps', () => {
  const source = new THREE.Group(),
    a = new THREE.MeshBasicMaterial(),
    b = new THREE.MeshBasicMaterial();
  const indexed = new THREE.BoxGeometry(1, 1, 1),
    nonIndexed = indexed.toNonIndexed();
  for (const [anchor, material, geometry] of [
    [0, a, indexed],
    [7, b, indexed],
    [undefined, a, nonIndexed],
    [11, a, indexed],
    [9, b, nonIndexed],
  ] as const) {
    const mesh = new THREE.Mesh(geometry, material);
    if (anchor !== undefined) mesh.userData.pickAnchor = anchor;
    source.add(mesh);
  }
  const batch = batchGroup(source);
  try {
    assert.equal(batch.children.length, 2);
    for (const child of batch.children) {
      const mesh = child as THREE.Mesh;
      const expected = mesh.material === a ? [0, null, 11] : [7, 9];
      for (let i = 0; i < expected.length * 12; i++)
        assert.equal(
          getBatchTriangleOwner(mesh, i),
          expected[Math.floor(i / 12)],
          `owner for triangle ${i}`,
        );
      for (const invalid of [undefined, null, -1, 0.5, NaN, Infinity, expected.length * 12])
        assert.equal(getBatchTriangleOwner(mesh, invalid), null);
    }
    assert.equal(getBatchTriangleOwner(batch, 0), null);
    const plain = new THREE.Mesh(indexed, a);
    assert.equal(getBatchTriangleOwner(plain, 0), null, 'unbatched terrain has no owner');
  } finally {
    disposeGroup(batch);
    indexed.dispose();
    nonIndexed.dispose();
    a.dispose();
    b.dispose();
  }
});

test('terrain-only batches return null and cancellation retains source geometry/material ownership', () => {
  const source = new THREE.Group(),
    material = new THREE.MeshBasicMaterial();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  source.add(new THREE.Mesh(geometry, material));
  let sourceDisposed = 0,
    materialDisposed = 0;
  geometry.addEventListener('dispose', () => sourceDisposed++);
  material.addEventListener('dispose', () => materialDisposed++);
  const batch = batchGroup(source);
  assert.equal(getBatchTriangleOwner(batch.children[0], 0), null);
  disposeGroup(batch);
  const pending = batchGroupSteps(source);
  assert.equal(pending.next().done, false);
  pending.return(undefined as never);
  assert.equal(sourceDisposed, 0);
  assert.equal(materialDisposed, 0);
  geometry.dispose();
  material.dispose();
});

test('real building chunks tag anchor zero and linked parcels before merging', () => {
  const state = createCity(91, true, 40);
  for (const tile of state.tiles)
    Object.assign(tile, { kind: 'empty', elevation: 0, anchor: -1, level: 0 });
  Object.assign(state.tiles[0], { kind: 'commercial', level: 1, variation: 0 });
  const anchor = 5 * state.size + 5;
  for (let z = 5; z < 7; z++)
    for (let x = 5; x < 8; x++)
      Object.assign(state.tiles[z * state.size + x], {
        kind: 'commercial',
        level: 3,
        variation: 1,
        anchor,
        lotWidth: 3,
        lotDepth: 2,
      });
  const city = new THREE.Group(),
    live = new THREE.Group(),
    rock = new THREE.MeshBasicMaterial();
  const chunks = createBuildingChunks(city, live, rock);
  try {
    chunks.update(state, true);
    for (const [x, z, expected] of [
      [-19.5, -19.5, 0],
      [-13.5, -13.8, anchor],
    ]) {
      const hit = cast(city, x, z);
      assert.equal(getBatchTriangleOwner(hit.object, hit.faceIndex), expected);
    }
  } finally {
    for (const child of [...city.children]) disposeGroup(child);
    rock.dispose();
  }
});
