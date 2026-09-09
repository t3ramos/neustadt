import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { residentialArchitecture } from '../../src/rendering/buildings/residential-architecture';
import { addFourSidedOpenings } from '../../src/rendering/buildings/facade-openings';
import { setModelNightBlend } from '../../src/rendering/buildings/materials';
import { extractDrivingCollisionShapes } from '../../src/vehicles/collisions';
import type { Tile } from '../../src/domain/types';

function model(variation: number, level: number, w = 1, d = 1, centered = false): THREE.Group {
  const group = new THREE.Group();
  residentialArchitecture(
    group,
    { kind: 'residential', variation, level, lotWidth: w, lotDepth: d } as Tile,
    centered,
  );
  group.updateMatrixWorld(true);
  return group;
}
function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) result.push(child);
  });
  return result;
}

test('garden villas and paired homes have substantial rounded occupied silhouettes at every density', () => {
  for (const family of [2, 4])
    for (const level of [1, 2, 3, 4]) {
      const group = model(family, level);
      const parts = meshes(group);
      const bays = parts.filter((part) => part.name === 'residential-rounded-bay');
      assert.ok(bays.length > 0);
      const bodies = parts.filter((part) => part.name === 'residential-occupied-body');
      for (const bay of bays) {
        assert.ok(
          bay.scale.y >= 0.3 && bay.scale.x >= 0.24,
          'curvature must belong to occupied mass, not trim',
        );
        const bounds = new THREE.Box3().setFromObject(bay);
        assert.ok(
          bodies.some((body) => new THREE.Box3().setFromObject(body).intersectsBox(bounds)),
          'rounded volume must attach to a structural body',
        );
        const collision = extractDrivingCollisionShapes(bay);
        assert.ok(
          collision.some((shape) => shape.maxY - shape.minY >= 0.3),
          'rounded volume needs a usable physical collision shape',
        );
      }
      if (level >= 2) {
        assert.ok(parts.some((part) => part.name === 'residential-curved-balcony'));
        assert.ok(parts.some((part) => part.name === 'residential-curved-parapet'));
      }
      if (family === 4) {
        const collision = extractDrivingCollisionShapes(group);
        assert.ok(
          !collision.some(
            (shape) =>
              shape.minX < -0.04 &&
              shape.maxX > 0.04 &&
              shape.minZ < -0.33 &&
              shape.maxZ > -0.33 &&
              shape.minY < 0.25 &&
              shape.maxY > 0.25,
          ),
          'paired rounded bays must not bridge the central passage',
        );
      }
    }
});

test('every residential family and density stays within the lot with bounded geometry and separate occupied masses', () => {
  for (let variation = 0; variation < 20; variation++)
    for (const level of [1, 2, 3, 4])
      for (const [w, d] of [
        [1, 1],
        [2, 1],
        [1, 2],
        [2, 2],
        [3, 2],
        [2, 3],
      ]) {
        const group = model(variation, level, w, d),
          parts = meshes(group);
        const label = `${variation}/${level}/${w}x${d}`;
        const bounds = new THREE.Box3().setFromObject(group);
        assert.ok(bounds.min.x >= -0.5001 && bounds.max.x <= w - 0.4999, `X ${label}`);
        assert.ok(bounds.min.z >= -0.5001 && bounds.max.z <= d - 0.4999, `Z ${label}`);
        assert.ok(bounds.min.y >= 0, `ground ${label}`);
        assert.ok(parts.length <= 65, `mesh budget ${label}: ${parts.length}`);
        const triangles = parts.reduce(
          (sum, part) =>
            sum + (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3,
          0,
        );
        assert.ok(triangles <= 12500, `triangle budget ${label}: ${triangles}`);
        const bodies = parts.filter((part) => part.name === 'residential-occupied-body');
        assert.ok(bodies.length > 0);
        for (let i = 0; i < bodies.length; i++)
          for (let j = i + 1; j < bodies.length; j++) {
            const overlap = new THREE.Box3()
              .setFromObject(bodies[i])
              .intersect(new THREE.Box3().setFromObject(bodies[j]));
            assert.ok(
              overlap.isEmpty() ||
                overlap
                  .getSize(new THREE.Vector3())
                  .toArray()
                  .some((v) => v < 0.001),
              `overlapping occupied bodies ${label}`,
            );
          }
      }
});

test('residential templates share resources without sharing mutable transforms or overwriting crafted facades', () => {
  for (let family = 0; family < 5; family++) {
    const a = model(family, 3, 2, 1),
      b = model(family, 3, 2, 1, true);
    const left = meshes(a),
      right = meshes(b);
    assert.equal(left.length, right.length);
    const originalMaterials = left.map((part) => part.material);
    addFourSidedOpenings(a);
    left.forEach((part, index) => {
      assert.notEqual(part, right[index]);
      assert.equal(part.geometry, right[index].geometry);
      assert.equal(part.material, right[index].material);
      assert.equal(part.material, originalMaterials[index]);
    });
    assert.equal(a.children[0].position.x, 0.5);
    assert.equal(b.children[0].position.x, 0);
    a.children[0].position.x = 99;
    assert.equal(b.children[0].position.x, 0);
  }
});

test('residential lighting remains individual opaque panes and courtyard colliders keep the central gap open', () => {
  const group = model(1, 3);
  try {
    setModelNightBlend(1);
    const lights = meshes(group).filter((part) => part.userData.buildingWindowLight);
    assert.ok(lights.length > 0);
    for (const light of lights) {
      const material = light.material as THREE.MeshStandardMaterial;
      assert.equal(material.transparent, false);
      assert.equal(material.emissiveIntensity, 0.2);
      assert.ok(light.scale.x * light.scale.y <= 0.025);
    }
    const shapes = extractDrivingCollisionShapes(group);
    assert.ok(shapes.length > 0);
    // Neither merged frames nor disconnected facade details may form a hull
    // spanning both residential wings across the open front courtyard.
    assert.ok(
      !shapes.some(
        (shape) =>
          shape.minX < -0.1 &&
          shape.maxX > 0.1 &&
          shape.minZ < 0.16 &&
          shape.maxZ > 0.16 &&
          shape.minY < 0.5 &&
          shape.maxY > 0.5,
      ),
    );
  } finally {
    setModelNightBlend(0);
  }
});
