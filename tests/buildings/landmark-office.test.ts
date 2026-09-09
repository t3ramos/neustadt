import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createLandmarkOfficeDetails,
  landmarkWindowBounds,
} from '../../src/rendering/buildings/landmark-office';

async function sourceModel() {
  const bytes = await readFile(
    new URL('../../public/assets/models/easter-egg-office.glb', import.meta.url),
  );
  return (
    await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
  ).scene;
}

test('terrace-only refinement preserves facade space and uses a small shared batch budget', async () => {
  const source = await sourceModel();
  const panes = landmarkWindowBounds(source);
  assert.ok(panes.length > 100, `Expected individual facade panes, got ${panes.length}`);
  const details = createLandmarkOfficeDetails();
  assert.equal(details.children.length, 5);
  const bounds = new THREE.Box3().setFromObject(details);
  assert.ok(bounds.min.x >= -1.5 && bounds.max.x <= 1.5);
  assert.ok(bounds.min.z >= -1 && bounds.max.z <= 1);
  assert.ok(bounds.min.y >= 0.8239 && bounds.max.y <= 0.960815, 'No overlays below the terrace');
  assert.ok(
    bounds.min.x > 0.2 && bounds.min.z > 0.24,
    'Only the accepted terrace strip is occupied',
  );
  let triangles = 0;
  const clone = details.clone(true);
  details.children.forEach((child, i) => {
    assert.ok(child instanceof THREE.Mesh);
    assert.ok(child.material instanceof THREE.MeshStandardMaterial);
    assert.equal(child.geometry.userData.easterEggShared, true);
    assert.equal(child.material.userData.easterEggShared, true);
    assert.equal(child.material.map, null);
    assert.equal((clone.children[i] as THREE.Mesh).geometry, child.geometry);
    assert.equal((clone.children[i] as THREE.Mesh).material, child.material);
    triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3;
  });
  assert.ok(triangles < 1500, `Overlay triangle budget exceeded: ${triangles}`);
});

test('original sign, doorway, front roof and canopy effect patch stay unobstructed', async () => {
  const source = await sourceModel();
  const details = createLandmarkOfficeDetails();
  source.updateMatrixWorld(true);
  details.updateMatrixWorld(true);
  const ray = (origin: number[], direction: number[]) =>
    new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction));
  // Roof effects and the open front half must encounter the unmodified source first.
  for (const x of [-0.22, -0.06, 0.1])
    for (const z of [-0.28, -0.17, -0.07, 0.15]) {
      assert.equal(ray([x, 2, z], [0, -1, 0]).intersectObject(details, true).length, 0);
    }
  for (const x of [-0.15, 0, 0.15])
    for (const y of [0.04, 0.08, 0.12]) {
      assert.equal(
        ray([x, y, 1], [0, 0, -1]).intersectObject(details, true).length,
        0,
        'Door approach is clear',
      );
    }
  let logo: THREE.Mesh | undefined;
  source.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !Array.isArray(object.material) &&
      object.material.name === 'Easter Egg amber'
    )
      logo = object;
  });
  assert.ok(logo);
  const logoBounds = new THREE.Box3().setFromObject(logo);
  const c = logoBounds.getCenter(new THREE.Vector3());
  const logoRay = ray([c.x, c.y, 1], [0, 0, -1]);
  logoRay.far = 1 - logoBounds.max.z;
  assert.equal(logoRay.intersectObject(details, true).length, 0, 'Original logo is unobstructed');
  // Window centers remain open: added reveals must not become opaque replacement glazing.
  for (const pane of landmarkWindowBounds(source)) {
    const c = pane.getCenter(new THREE.Vector3());
    const s = pane.getSize(new THREE.Vector3());
    const frontRear = s.x > s.z;
    const sign = Math.sign(frontRear ? c.z : c.x);
    const direction = frontRear ? new THREE.Vector3(0, 0, -sign) : new THREE.Vector3(-sign, 0, 0);
    const origin = c.clone().addScaledVector(direction, -0.04);
    const hits = new THREE.Raycaster(origin, direction, 0, 0.041).intersectObject(details, true);
    assert.equal(hits.length, 0, `Window center blocked at ${c.toArray()}`);
  }
});
