import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingLightIntensity } from '../src/scene.ts';

test('building-light switch has a visible daytime floor and smoothly follows nightfall when enabled',()=>{
  assert.equal(buildingLightIntensity(0,true),.18);
  assert.equal(buildingLightIntensity(.5,true),.59);
  assert.equal(buildingLightIntensity(1,true),1);
  assert.equal(buildingLightIntensity(-1,true),.18);
  assert.equal(buildingLightIntensity(2,true),1);
});

test('building lights switched off remain exactly dark independently of the clock',()=>{
  for(const nightBlend of [0,.1,.5,.9,1,Number.NaN])assert.equal(buildingLightIntensity(nightBlend,false),0);
  assert.equal(buildingLightIntensity(Number.NaN,true),.18);
});
