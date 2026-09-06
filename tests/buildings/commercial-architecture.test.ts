import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { commercialHighrise } from '../../src/rendering/buildings/architecture';
import { setModelNightBlend, setModelWet } from '../../src/rendering/buildings/materials';
import type { Tile } from '../../src/domain/types';

const families = ['curtain', 'brick', 'limestone', 'charcoal', 'campus'];
test('five commercial systems preserve lot bounds, distinct facades and inexpensive occupied massing', () => {
  const facadeNames = new Set<string>();
  for (let variation = 0; variation < 5; variation++)
    for (const [w, d] of [
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
      [2, 3],
    ]) {
      let previousHeight = 0;
      for (const level of [3, 4]) {
        const group = new THREE.Group();
        commercialHighrise(group, { variation, level, lotWidth: w, lotDepth: d } as Tile);
        group.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(group);
        assert.ok(bounds.min.x >= -0.5 && bounds.max.x <= w - 0.5);
        assert.ok(bounds.min.z >= -0.5 && bounds.max.z <= d - 0.5);
        assert.ok(bounds.min.y >= 0);
        assert.ok(
          bounds.max.y > previousHeight,
          'mature commercial towers must grow beyond their earlier stage',
        );
        previousHeight = bounds.max.y;
        assert.ok(group.getObjectByName(`commercial-${families[variation]}`));
        let meshes = 0,
          roofs = 0;
        group.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          meshes++;
          if (child.name === 'commercial-roof') {
            roofs++;
            assert.ok(child.userData.fireRoof);
          }
          const material = child.material as THREE.MeshStandardMaterial;
          if (material.userData.facadeTexture) {
            facadeNames.add(material.name);
            assert.ok(material.map && material.emissiveMap && material.roughnessMap);
          }
        });
        assert.ok(meshes <= 25, `family ${variation} exceeds the cheap geometry budget: ${meshes}`);
        assert.ok(roofs >= 2, 'occupied wings need individually represented actual roofs');
      }
    }
  assert.equal(facadeNames.size, 5);
});

test('textured commercial windows stay opaque and sparsely lit at night without pane geometry', () => {
  const group = new THREE.Group();
  commercialHighrise(group, { variation: 1, level: 4, lotWidth: 2, lotDepth: 2 } as Tile);
  try {
    setModelNightBlend(1);
    setModelWet(true);
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      if (!material.userData.facadeTexture) return;
      assert.equal(material.transparent, false);
      assert.equal(material.opacity, 1);
      assert.equal(material.emissiveIntensity, 0.15);
      const data = (material.emissiveMap as THREE.DataTexture).image.data;
      assert.ok(data);
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]) lit++;
      assert.ok(
        lit > 0 && lit < (data.length / 4) * 0.2,
        'only a small fraction of facade texels may emit light',
      );
      setModelNightBlend(0);
      assert.equal(material.emissiveIntensity, 0);
      setModelNightBlend(1);
    });
  } finally {
    setModelNightBlend(0);
    setModelWet(false);
  }
});
