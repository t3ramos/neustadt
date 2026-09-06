import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { park } from '../../src/rendering/buildings/facilities';
import type { Tile } from '../../src/domain/types';

function meadow(x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  park(group, { kind: 'park', variation: 3, x, z } as Tile);
  group.updateMatrixWorld(true);
  return group;
}
test('open meadow parks fill their tiles, preserve a clear view and contain no raised beds', () => {
  const signatures = new Set<string>();
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 10; x++) {
      const model = meadow(x, z),
        bounds = new THREE.Box3().setFromObject(model);
      assert.equal(bounds.min.x, -0.5);
      assert.equal(bounds.max.x, 0.5);
      assert.equal(bounds.min.z, -0.5);
      assert.equal(bounds.max.z, 0.5);
      assert.ok(bounds.max.y < 0.12 && bounds.min.y >= 0);
      assert.ok(model.children.length <= 7, 'large meadow fields must stay inexpensive');
      for (const child of model.children) {
        assert.ok(child instanceof THREE.Mesh);
        if (child.geometry.type === 'BoxGeometry')
          assert.ok(child.scale.y <= 0.028, 'no raised rectangular planter blocks');
      }
      signatures.add(model.children.map((child) => child.position.toArray().join(',')).join('|'));
    }
  assert.ok(signatures.size > 30, 'coordinates must break repeated flower-bed patterns');
});
test('sparse meadow walks and lawns meet continuously at adjacent tile borders', () => {
  const ray = new THREE.Raycaster();
  const height = (group: THREE.Group, x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(group, true)[0];
    assert.ok(hit);
    return hit.point.y;
  };
  for (let z = 0; z < 7; z++) {
    const a = meadow(5, z),
      b = meadow(5, z + 1);
    assert.ok(Math.abs(height(a, 0, 0.499) - height(b, 0, -0.499)) < 1e-8);
  }
  for (let x = 0; x < 9; x++) {
    const a = meadow(x, 4),
      b = meadow(x + 1, 4);
    assert.ok(Math.abs(height(a, 0.499, 0) - height(b, -0.499, 0)) < 1e-8);
    assert.ok(Math.abs(height(a, 0.499, 0.3) - height(b, -0.499, 0.3)) < 1e-8);
  }
});
test('meadow details are deterministic and reuse shared geometry across tiles', () => {
  const a = meadow(3, 7),
    b = meadow(3, 7);
  assert.equal(a.children.length, b.children.length);
  a.children.forEach((child, i) => {
    assert.deepEqual(child.position.toArray(), b.children[i].position.toArray());
    assert.equal((child as THREE.Mesh).geometry, (b.children[i] as THREE.Mesh).geometry);
  });
});

test('detailed flower drifts contain petals, contrasting centres and leaves in one shared mesh', () => {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  let planted = 0;
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 10; x++) {
      const model = meadow(x, z);
      const flowers = model.getObjectByName('meadow-flower-cluster') as THREE.Mesh | undefined;
      if (!flowers) continue;
      planted++;
      assert.equal(flowers.userData.drivingSurface, true);
      assert.equal(flowers.castShadow, false);
      const geometry = flowers.geometry;
      assert.equal(geometry.userData.flowerCount, 4);
      assert.ok(geometry.userData.petalsPerFlower >= 5);
      assert.ok(
        geometry.getAttribute('position').count / 3 <= 320,
        'detail must remain a bounded static cluster',
      );
      const positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal');
      for (let start = 0; start < positions.count; start += 24) {
        const centre = new THREE.Vector3();
        for (let i = start; i < start + 24; i++)
          centre.add(new THREE.Vector3().fromBufferAttribute(positions, i));
        centre.divideScalar(24);
        for (let i = start; i < start + 24; i += 3) {
          const outward = new THREE.Vector3().fromBufferAttribute(positions, i).sub(centre);
          assert.ok(
            outward.dot(new THREE.Vector3().fromBufferAttribute(normals, i)) > 0,
            'petals and leaves must face outward, not vanish through back-face culling',
          );
        }
      }
      const colors = geometry.getAttribute('color'),
        distinct = new Set<string>();
      for (let i = 0; i < colors.count; i++)
        distinct.add(`${colors.getX(i)},${colors.getY(i)},${colors.getZ(i)}`);
      assert.ok(distinct.size >= 5, 'petals, centres, stems and leaves retain different colours');
      assert.ok(new THREE.Box3().setFromObject(flowers).max.y < 0.11);
      geometries.add(geometry);
      materials.add(flowers.material as THREE.Material);
      assert.ok(
        model.children.length <= 4,
        'the detailed drift replaces several old meshes with one',
      );
    }
  assert.ok(planted > 30);
  assert.ok(geometries.size <= 3);
  assert.equal(materials.size, 1);
});
