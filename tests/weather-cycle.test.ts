import assert from 'node:assert/strict';
import test from 'node:test';
import { createCity,serializeCity,deserializeCity,triggerDisaster } from '../src/simulation';
import { advanceWeather,chooseWeather,initializeWeather } from '../src/weather-cycle';
import { createWeatherEffects } from '../src/weather-graphics';
import { perMinute,playTime,stepTime } from '../src/game-time';
import * as THREE from 'three';
import type { DisasterKind } from '../src/types';

test('automatic weather alternates clear spells and showers without damaging the city',()=>{
  const state=createCity(7341);const before=JSON.stringify(state.tiles),money=state.money;
  const first=state.settings.weatherRemaining!;assert.ok(first>=150&&first<=300);
  assert.equal(advanceWeather(state,first+.01),true);assert.equal(state.settings.weather,'rain');
  assert.ok(state.settings.weatherRemaining!>=59&&state.settings.weatherRemaining!<=150);
  advanceWeather(state,state.settings.weatherRemaining!+.01);assert.equal(state.settings.weather,'clear');
  assert.equal(JSON.stringify(state.tiles),before);assert.equal(state.money,money);
});

test('weather survives save/reload and has the same phases across frame subdivision',()=>{
  const a=createCity(9),b=deserializeCity(serializeCity(a));
  advanceWeather(a,751);for(let i=0;i<7510;i++)advanceWeather(b,.1);
  assert.equal(a.settings.weather,b.settings.weather);assert.equal(a.settings.weatherCycle,b.settings.weatherCycle);
  assert.ok(Math.abs(a.settings.weatherRemaining!-b.settings.weatherRemaining!)<1e-7);
  const copy=deserializeCity(serializeCity(a));assert.deepEqual(copy.settings,a.settings);
  const snapshot=structuredClone(copy.settings);for(const dt of [0,-1,NaN,Infinity])advanceWeather(copy,dt);
  assert.deepEqual(copy.settings,snapshot);
});

test('manual weather stays selected until automatic weather is enabled again',()=>{
  const state=createCity(32);chooseWeather(state,'rain');const remaining=state.settings.weatherRemaining;
  assert.equal(advanceWeather(state,10000),false);assert.equal(state.settings.weather,'rain');
  assert.equal(state.settings.weatherRemaining,remaining);
  state.settings.dynamicWeather=true;advanceWeather(state,remaining!+1);assert.equal(state.settings.weather,'clear');
});

test('older saves receive automatic weather defaults and malformed phase data is rejected',()=>{
  const state=createCity(10);delete state.settings.dynamicWeather;delete state.settings.weatherRemaining;delete state.settings.weatherCycle;
  const old=JSON.stringify(state),copy=deserializeCity(old);assert.equal(copy.settings.dynamicWeather,true);
  assert.ok(copy.settings.weatherRemaining!>0);initializeWeather(copy);assert.equal(copy.settings.weather,'clear');
  for(const invalid of [{dynamicWeather:'yes'},{weatherRemaining:-1},{weatherCycle:.5}]){
    const raw=JSON.parse(old);Object.assign(raw.settings,invalid);assert.throws(()=>deserializeCity(JSON.stringify(raw)));
  }
});

test('clear weather fades rain and dries puddles rather than leaving permanent wet surfaces',t=>{
  const state=createCity(13);chooseWeather(state,'rain');
  const scene=new THREE.Scene(),weather=createWeatherEffects(scene,state);t.after(()=>weather.dispose());
  assert.ok(weather.getDebug().puddles>0);weather.setWeather('clear');
  for(let i=0;i<1800;i++)weather.animate(1/60,i/60,new THREE.Vector3());
  assert.equal(weather.getDebug().puddles,0);assert.equal(weather.isWet(),false);
  assert.equal(scene.getObjectByName('local-rain-streaks')!.visible,false);
  weather.setWeather('rain');for(let i=0;i<300;i++)weather.animate(1/60,i/60,new THREE.Vector3());
  assert.ok(weather.getDebug().puddles>0);assert.equal(weather.isWet(),true);
});

test('removed flood requests cannot mutate a city even when disaster tools are enabled',()=>{
  const state=createCity(93);state.settings.disastersEnabled=true;const before=serializeCity(state);
  assert.equal(triggerDisaster(state,'flood' as DisasterKind).ok,false);assert.equal(serializeCity(state),before);
});

test('real-time labels and per-minute rates correspond to the existing economic cadence',()=>{
  assert.equal(perMinute(100),1200);assert.equal(perMinute(-9),-108);
  assert.equal(playTime(0),'0:00');assert.equal(playTime(65.9),'1:05');assert.equal(playTime(3665),'1:01:05');
  assert.equal(stepTime(60),'5:00');assert.equal(stepTime(120),'10:00');
});

test('saved play time retains the fractional economic interval and rejects invalid clock progress',()=>{
  const state=createCity(26);state.month=15;state.tickProgress=2.625;
  const loaded=deserializeCity(serializeCity(state));
  assert.equal(loaded.tickProgress,2.625);assert.equal(playTime(loaded.month*5+loaded.tickProgress!),'1:17');
  for(const value of [-1,5,'2',null]){
    const raw=JSON.parse(serializeCity(state));raw.tickProgress=value;
    assert.throws(()=>deserializeCity(JSON.stringify(raw)));
  }
});
