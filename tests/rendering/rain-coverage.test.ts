import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../../src/simulation/city-simulation';
import {
  createWeatherEffects,
  MAX_RAIN_DROPS,
  rainCoverage,
  rainDropSeed,
  rainLengthScale,
} from '../../src/rendering/effects/weather';

test('seeded rain covers each full map and context margin without a camera-dependent center', () => {
  for (const size of [40, 64, 96, 128]) {
    const coverage = rainCoverage(size, 12),
      cells = new Set<number>();
    assert.ok(coverage.halfExtent >= size / 2 + Math.max(12, size * 0.25));
    assert.ok(coverage.top > 12 + 15);
    assert.ok(coverage.count <= MAX_RAIN_DROPS);
    let changes = 0;
    for (let i = 0; i < coverage.count; i++) {
      const drop = rainDropSeed(i, 83, coverage);
      assert.deepEqual(drop, rainDropSeed(i, 83, coverage));
      assert.ok(drop.x > -coverage.halfExtent && drop.x < coverage.halfExtent);
      assert.ok(drop.z > -coverage.halfExtent && drop.z < coverage.halfExtent);
      const x = Math.floor(((drop.x + coverage.halfExtent) / (coverage.halfExtent * 2)) * 8);
      const z = Math.floor(((drop.z + coverage.halfExtent) / (coverage.halfExtent * 2)) * 8);
      cells.add(z * 8 + x);
      assert.ok(drop.phase >= 0 && drop.phase < 1 && drop.speed >= 9 && drop.speed <= 13);
      if (drop.x !== rainDropSeed(i, 84, coverage).x) changes++;
    }
    assert.equal(cells.size, 64, 'Every region including all four corners has rain');
    assert.equal(changes, coverage.count, 'The city seed controls every independent drop');
  }
});

test('rain has one shadow-free world batch and no position uploads while panning, zooming or driving', (t) => {
  const state = createCity(37, true, 128);
  state.settings.weather = 'rain';
  const scene = new THREE.Scene(),
    effects = createWeatherEffects(scene, state);
  t.after(() => effects.dispose());
  const rain = scene.getObjectByName('world-rain-streaks') as THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
  assert.ok(rain.isLineSegments && rain.material.isShaderMaterial);
  assert.equal(rain.castShadow, false);
  assert.equal(rain.receiveShadow, false);
  assert.equal(rain.material.depthTest, true);
  assert.equal(rain.material.depthWrite, false);
  const geometry = rain.geometry,
    attributes = Object.values(geometry.attributes);
  const versions = attributes.map((attribute) => (attribute as THREE.BufferAttribute).version);
  const initialPosition = rain.position.clone();
  const camera = new THREE.OrthographicCamera(-64, 64, 64, -64, 0.1, 1000);
  for (let i = 0; i < 120; i++) {
    camera.zoom = 0.25 + i / 40;
    camera.position.set(-60 + i, 25, Math.sin(i) * 60);
    effects.animate(1 / 60, i / 60, new THREE.Vector3(-60 + i, i % 14, 60 - i), camera, 900);
  }
  effects.animate(0.1, 3, new THREE.Vector3(62, 12, -61), new THREE.PerspectiveCamera(), 900);
  assert.deepEqual(rain.position, initialPosition);
  assert.deepEqual(
    attributes.map((attribute) => (attribute as THREE.BufferAttribute).version),
    versions,
  );
  assert.equal(rain.geometry, geometry);
  assert.equal(effects.getDebug().rainDrawCalls, 1);
  assert.ok(effects.getDebug().rainDrops <= MAX_RAIN_DROPS);
  assert.ok(rain.material.uniforms.uTime.value === 3);
  assert.equal(rain.material.uniforms.uLengthScale.value, 1);
  const drops = geometry.getAttribute('aDrop');
  for (let i = 0; i < geometry.drawRange.count; i++)
    assert.ok(drops.getW(i) < effects.getDebug().rainCoverage.top - 15);
  effects.update(state);
  assert.deepEqual(
    attributes.map((attribute) => (attribute as THREE.BufferAttribute).version),
    versions,
    'Unchanged terrain does not rebuild buffers',
  );
  effects.setWeather('clear');
  for (let i = 0; i < 120; i++) effects.animate(0.25, i / 4, new THREE.Vector3());
  assert.equal(effects.getDebug().rainDrawCalls, 0);
  assert.equal(rain.visible, false);
});

test('terrain changes refresh the fixed rain volume and zoom affects only bounded streak readability', (t) => {
  const state = createCity(42, true, 40),
    scene = new THREE.Scene(),
    effects = createWeatherEffects(scene, state);
  t.after(() => effects.dispose());
  const rain = scene.getObjectByName('world-rain-streaks') as THREE.LineSegments;
  const attribute = rain.geometry.getAttribute('aDrop') as THREE.BufferAttribute;
  const version = attribute.version;
  state.tiles[0].elevation = 20;
  effects.update(state);
  assert.ok(attribute.version > version);
  assert.equal(effects.getDebug().rainCoverage.top, 42);
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20);
  const close = rainLengthScale(camera, 900);
  camera.zoom = 0.1;
  assert.ok(rainLengthScale(camera, 900) > close);
  camera.zoom = 0.001;
  assert.equal(rainLengthScale(camera, 900), 4);
  assert.equal(rainLengthScale(new THREE.PerspectiveCamera()), 1);
});
