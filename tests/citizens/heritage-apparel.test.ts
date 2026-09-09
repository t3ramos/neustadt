import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createDoubleEagleGeometry,
  heritageAppearance,
} from '../../src/citizens/heritage-apparel.ts';

test('eagle has centered unit bounds, finite positions and +Z normals', () => {
  const geometry = createDoubleEagleGeometry();
  assert.deepEqual(geometry.boundingBox!.min.toArray(), [-0.5, -0.5, 0]);
  assert.deepEqual(geometry.boundingBox!.max.toArray(), [0.5, 0.5, 0]);
  assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) assert.equal(normals.getZ(i), 1);
  geometry.dispose();
});

test('triangles cover the full connected contour without holes or degenerate faces', () => {
  const geometry = createDoubleEagleGeometry();
  const p = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  assert.equal(index.count % 3, 0);
  assert.equal(index.count / 3, p.count - 2);
  let triangleArea = 0,
    contourArea = 0;
  for (let i = 0; i < p.count; i++) {
    const next = (i + 1) % p.count;
    contourArea += p.getX(i) * p.getY(next) - p.getX(next) * p.getY(i);
  }
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    for (const vertex of [a, b, c]) assert.ok(vertex >= 0 && vertex < p.count);
    const twiceArea =
      (p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
      (p.getY(b) - p.getY(a)) * (p.getX(c) - p.getX(a));
    assert.ok(twiceArea > 1e-9, 'nondegenerate front-facing triangle');
    triangleArea += twiceArea;
  }
  assert.ok(Math.abs(triangleArea - Math.abs(contourArea)) < 1e-6);
  assert.ok(triangleArea / 2 > 0.2 && triangleArea / 2 < 0.6);
  geometry.dispose();
});

test('two heads have a visible central cleft and left-right symmetry', () => {
  const geometry = createDoubleEagleGeometry();
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    assert.ok(
      Array.from({ length: p.count }, (_, j) => j).some(
        (j) => Math.abs(p.getX(j) + p.getX(i)) < 1e-7 && Math.abs(p.getY(j) - p.getY(i)) < 1e-7,
      ),
    );
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  const hit = (x: number, y: number) =>
    new THREE.Raycaster(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1)).intersectObject(
      mesh,
    ).length > 0;
  assert.equal(hit(0, 0.4), false);
  assert.equal(hit(-0.1, 0.42), true);
  assert.equal(hit(0.1, 0.42), true);
  assert.equal(hit(0, 0), true);
  mesh.material.dispose();
  geometry.dispose();
});

test('front and back can share geometry and render outward with one disposal', () => {
  const geometry = createDoubleEagleGeometry();
  const material = new THREE.MeshBasicMaterial({ color: 0x080808 });
  const front = new THREE.Mesh(geometry, material),
    back = new THREE.Mesh(geometry, material);
  front.position.z = 0.1;
  back.position.z = -0.1;
  back.rotation.y = Math.PI;
  for (const [mesh, sign] of [
    [front, 1],
    [back, -1],
  ] as const) {
    mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, sign), new THREE.Vector3(0, 0, -sign));
    assert.ok(ray.intersectObject(mesh).length > 0);
  }
  assert.equal(front.geometry, back.geometry);
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  front.removeFromParent();
  assert.equal(disposed, 0);
  geometry.dispose();
  assert.equal(disposed, 1);
  material.dispose();
});

test('only the confirmed purple-hat variant selects heritage clothing', () => {
  assert.deepEqual(heritageAppearance(3), { sweater: 0xe51b23, badge: 0x080808 });
  assert.ok(heritageAppearance(123));
  for (const variant of [0, 1, 2, 4, 5, -117, 3.5, NaN, Infinity])
    assert.equal(heritageAppearance(variant), undefined);
});
