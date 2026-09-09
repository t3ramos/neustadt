import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  citizenScreenHeight,
  citizenUsesDetail,
  createCitizenLodGeometries,
} from '../../src/citizens/appearance-lod.ts';

test('screen-size estimate handles orthographic zoom, viewport size and overhead views', () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 30, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  assert.equal(citizenScreenHeight(camera, origin, 0.16, 1000), 8);
  camera.zoom = 2;
  camera.updateProjectionMatrix();
  assert.equal(citizenScreenHeight(camera, origin, 0.16, 1000), 16);
  assert.equal(citizenScreenHeight(camera, origin, 0.16, 500), 8);
});

test('perspective detail follows camera depth and zoom, with behind-camera actors excluded', () => {
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld(true);
  const near = citizenScreenHeight(camera, new THREE.Vector3(), 0.16, 1000);
  const far = citizenScreenHeight(camera, new THREE.Vector3(0, 0, -10), 0.16, 1000);
  assert.ok(Math.abs(near - far * 2) < 1e-9);
  camera.zoom = 2;
  camera.updateProjectionMatrix();
  assert.ok(
    Math.abs(citizenScreenHeight(camera, new THREE.Vector3(), 0.16, 1000) - near * 2) < 1e-9,
  );
  assert.equal(citizenScreenHeight(camera, new THREE.Vector3(0, 0, 11), 0.16, 1000), 0);
});

test('detail hysteresis does not toggle repeatedly around the entry threshold', () => {
  assert.equal(citizenUsesDetail(17.9), false);
  assert.equal(citizenUsesDetail(18), true);
  assert.equal(citizenUsesDetail(17.9, true), true);
  assert.equal(citizenUsesDetail(14, true), true);
  assert.equal(citizenUsesDetail(13.9, true), false);
});

test('distant silhouette has three reusable parts and a city-scale triangle budget', () => {
  const geometries = createCitizenLodGeometries();
  let triangles = 0;
  const bounds = new THREE.Box3();
  for (const geometry of Object.values(geometries)) {
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
    assert.ok(Array.from(geometry.getAttribute('position').array).every(Number.isFinite));
    geometry.dispose();
  }
  assert.ok(triangles <= 200);
  assert.ok(triangles * 720 < 150000);
  assert.ok(Math.abs(bounds.min.y) < 1e-8);
  assert.ok(bounds.max.y > 0.54 && bounds.max.y < 0.58);
});
