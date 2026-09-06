import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { createRegionContext, getRegionMargin } from '../../src/rendering/world/surroundings.ts';

test('finite city plates do not add a misleading landscape outside playable bounds', () => {
  const material = new THREE.MeshStandardMaterial();
  try {
    for (const size of [40, 64, 96, 128]) {
      const city = createCity(2139, true, size),
        before = JSON.stringify(city);
      const group = createRegionContext(city, {
        ground: material,
        earth: material,
        rock: material,
      });
      assert.equal(
        getRegionMargin(size),
        0,
        'Ocean and weather bounds must agree with the finite board',
      );
      assert.equal(
        group.children.length,
        0,
        'No outer terrain, trees or fuzzy boundary ring remains',
      );
      assert.equal(group.userData.nonBuildable, true);
      assert.deepEqual(group.userData.ownedMaterials, []);
      assert.equal(
        JSON.stringify(city),
        before,
        'Removing surroundings does not alter saved fields or hills',
      );
    }
  } finally {
    material.dispose();
  }
});
