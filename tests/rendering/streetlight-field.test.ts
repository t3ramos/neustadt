import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createStreetlightField } from '../../src/rendering/lighting/streetlight-field';

test('every separated lamp has stable local lighting even when the city has hundreds of sources', (t) => {
  const field = createStreetlightField(128);
  t.after(() => field.dispose());
  const sources = [];
  for (let z = -60; z <= 60; z += 6)
    for (let x = -60; x <= 60; x += 6)
      sources.push({ id: sources.length, bulb: new THREE.Vector3(x, 0.49, z) });
  field.update(sources);
  field.setStrength(1);
  assert.equal(field.getDebug().sources, 441);
  sources.forEach((source, index) =>
    assert.ok(field.sourcesAt(source.bulb.x, source.bulb.z).includes(index)),
  );
  assert.deepEqual(field.sourcesAt(1000, 1000), []);
  field.update([]);
  assert.deepEqual(field.sourcesAt(0, 0), []);
});

test('a replacement scene rebinds shared materials once and retains existing shader customization', () => {
  const a = createStreetlightField(40),
    b = createStreetlightField(64),
    root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial(),
    original = () => {};
  material.onBeforeCompile = original;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  root.add(mesh);
  a.applyTo(root);
  const first = material.onBeforeCompile,
    version = material.version;
  a.applyTo(root);
  assert.equal(material.onBeforeCompile, first);
  assert.equal(material.version, version);
  const key = material.customProgramCacheKey();
  b.applyTo(root);
  assert.notEqual(material.onBeforeCompile, first);
  assert.equal(material.customProgramCacheKey(), key);
  a.dispose();
  b.dispose();
  mesh.geometry.dispose();
  material.dispose();
});
