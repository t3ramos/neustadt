import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../../src/simulation/city-simulation';
import { createWeatherEffects } from '../../src/rendering/effects/weather';
import { getLightingProfile, sampleSkyRadiance } from '../../src/rendering/lighting/environment';

test('water batches have bounded draw count, valid bounds and dielectric materials through rebuild and drying', () => {
  const state = createCity(13);
  state.settings.weather = 'rain';
  const scene = new THREE.Scene(),
    weather = createWeatherEffects(scene, state);
  const group = scene.getObjectByName('rainwater-puddles')!;
  const batches = group.children as THREE.InstancedMesh[];
  assert.equal(batches.length, 8);
  assert.ok(batches.every((batch) => batch.isInstancedMesh));
  const count = () => batches.reduce((sum, batch) => sum + batch.count, 0);
  assert.equal(count(), weather.getDebug().puddles);
  assert.ok(count() > 0 && count() <= 160);
  for (const batch of batches.filter((batch) => batch.count > 0)) {
    assert.ok(Number.isFinite(batch.boundingSphere!.radius));
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, matrix);
      assert.ok(matrix.elements.every(Number.isFinite));
    }
  }
  const material = batches[0].material as THREE.MeshPhysicalMaterial;
  assert.equal(material.metalness, 0);
  assert.equal(material.ior, 1.333);
  assert.ok(material.alphaMap && material.normalMap);
  const alpha = (material.alphaMap as THREE.DataTexture).image.data as Uint8Array;
  assert.equal(alpha[1], 0, 'The shore texture must be transparent at its border');
  assert.ok(alpha[(32 * 64 + 32) * 4 + 1] > 240);
  const first = state.tiles.find((tile) => tile.kind === 'road')!;
  first.kind = 'empty';
  weather.update(state);
  assert.equal(group.children.length, 8, 'Rebuilding must reuse batches');
  assert.equal(count(), weather.getDebug().puddles);
  const wetRoughness = material.roughness;
  weather.setWeather('clear');
  for (let i = 0; i < 120; i++) weather.animate(0.25, i * 0.25, new THREE.Vector3());
  assert.equal(weather.getDebug().puddles, 0);
  assert.equal(weather.getDebug().puddleDrawCalls, 0);
  assert.ok(material.roughness > wetRoughness);
  let disposed = 0;
  for (const batch of batches) batch.addEventListener('dispose', () => disposed++);
  weather.dispose();
  weather.dispose();
  assert.equal(disposed, 8, 'Each instance buffer is disposed exactly once');
  assert.equal(scene.children.length, 0);
});

test('sky reflections carry finite world-aligned solar and lunar radiance across the clock', () => {
  for (const hour of [0, 6, 9, 12, 15, 18, 21]) {
    const profile = getLightingProfile(hour);
    const direction = profile.lightDirection;
    const toward = sampleSkyRadiance(profile, direction);
    const away = sampleSkyRadiance(
      profile,
      new THREE.Vector3(-direction.x, direction.y, -direction.z),
    );
    assert.ok(toward.r + toward.g + toward.b > away.r + away.g + away.b);
    for (let latitude = -0.9; latitude <= 0.9; latitude += 0.15) {
      const color = sampleSkyRadiance(profile, new THREE.Vector3(1, latitude, 0.3).normalize());
      assert.ok([color.r, color.g, color.b].every((value) => Number.isFinite(value) && value >= 0));
    }
    const before = direction.clone();
    const result = new THREE.Color();
    assert.equal(sampleSkyRadiance(profile, direction, result), result);
    assert.deepEqual(direction, before, 'Sampling cannot change the lighting direction');
  }
});
