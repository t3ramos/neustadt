import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { roof, roofGeometry } from '../../src/rendering/buildings/primitives';
import { roofSurfaceMaterial } from '../../src/rendering/buildings/roof-surface';
import { palette, setModelWet } from '../../src/rendering/buildings/materials';

test('pitched roofs retain their shared silhouette with finite noncollapsed surface UVs', () => {
  const first = new THREE.Group(),
    second = new THREE.Group();
  roof(first, palette.roof, 0, 1, 0, 1, 0.4, 1);
  roof(second, palette.roof, 0, 1, 0, 1, 0.4, 1);
  assert.equal(
    (first.children[0] as THREE.Mesh).geometry,
    (second.children[0] as THREE.Mesh).geometry,
  );
  assert.equal(
    (first.children[0] as THREE.Mesh).material,
    (second.children[0] as THREE.Mesh).material,
  );
  const uv = roofGeometry.getAttribute('uv');
  assert.equal(uv.count, roofGeometry.getAttribute('position').count);
  assert.ok([...uv.array].every(Number.isFinite));
  assert.ok(new Set(uv.array).size > 1);
});

test('roof relief is mipmapped, bounded and follows the existing wet weather switch', () => {
  const material = roofSurfaceMaterial(palette.terracotta);
  for (const texture of [material.map, material.normalMap]) {
    assert.ok(texture instanceof THREE.DataTexture);
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
    assert.ok(texture.generateMipmaps);
    assert.equal(texture.image.width, 128);
  }
  setModelWet(true);
  assert.equal(material.roughness, 0.4);
  setModelWet(false);
  assert.equal(material.roughness, 0.78);
});
