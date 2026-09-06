import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingLightIntensity } from '../../src/rendering/scene.ts';

test('building-light switch has a visible daytime floor and smoothly follows nightfall when enabled', () => {
  assert.equal(buildingLightIntensity(0, true), 0.18);
  assert.equal(buildingLightIntensity(0.5, true), 0.59);
  assert.equal(buildingLightIntensity(1, true), 1);
  assert.equal(buildingLightIntensity(-1, true), 0.18);
  assert.equal(buildingLightIntensity(2, true), 1);
});

test('building lights switched off remain exactly dark independently of the clock', () => {
  for (const nightBlend of [0, 0.1, 0.5, 0.9, 1, Number.NaN])
    assert.equal(buildingLightIntensity(nightBlend, false), 0);
  assert.equal(buildingLightIntensity(Number.NaN, true), 0.18);
});
