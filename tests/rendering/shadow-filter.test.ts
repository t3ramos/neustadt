import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyStableShadowFiltering,
  stableShadowChunk,
} from '../../src/rendering/lighting/environment.ts';

test('installed directional PCF becomes a normalized deterministic nine-tap filter without changing sampler semantics', () => {
  const original = THREE.ShaderChunk.shadowmap_pars_fragment,
    patched = stableShadowChunk();
  const start = patched.indexOf('float getShadow( sampler2DShadow'),
    end = patched.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )', start);
  const body = patched.slice(start, end);
  assert.notEqual(patched, original);
  assert.equal((body.match(/texture\( shadowMap/g) || []).length, 9);
  assert.ok(body.includes('shadowRadius / shadowMapSize'));
  assert.ok(body.includes('1.0 / 16.0'));
  assert.ok(!body.includes('gl_FragCoord'));
  assert.ok(!body.includes('vogelDiskSample'));
  assert.ok(body.includes('shadowCoord.xyz /= shadowCoord.w'));
  assert.ok(body.includes('shadowCoord.z += shadowBias'));
  assert.ok(body.includes('return mix( 1.0, shadow, shadowIntensity )'));
  const originalEnd = original.indexOf(
    '#elif defined( SHADOWMAP_TYPE_VSM )',
    original.indexOf('float getShadow( sampler2DShadow'),
  );
  assert.equal(patched.slice(end), original.slice(originalEnd));
  assert.equal(
    THREE.ShaderChunk.shadowmap_pars_fragment,
    original,
    'Global Three shader chunks remain unchanged',
  );
  assert.equal(stableShadowChunk(patched), patched, 'The patch is idempotent');
});

test('standard and physical materials get one cache-versioned hook, retaining prior customization and late material support', () => {
  const scene = new THREE.Scene(),
    first = new THREE.MeshStandardMaterial(),
    second = new THREE.MeshPhysicalMaterial(),
    basic = new THREE.MeshBasicMaterial();
  let previousCalled = 0;
  first.onBeforeCompile = (shader) => {
    previousCalled++;
    shader.fragmentShader += '\n// custom material';
  };
  first.customProgramCacheKey = () => 'existing-custom-key';
  scene.add(
    new THREE.Mesh(new THREE.BoxGeometry(), [first, second, basic]),
    new THREE.Mesh(new THREE.BoxGeometry(), first),
  );
  const initialVersion = first.version;
  applyStableShadowFiltering(scene);
  const afterFirstVersion = first.version;
  assert.equal(afterFirstVersion, initialVersion + 1);
  assert.ok(first.customProgramCacheKey().startsWith('existing-custom-key|'));
  assert.ok(second.customProgramCacheKey().includes('neustadt-pcf-tent-v1'));
  assert.ok(!basic.customProgramCacheKey().includes('neustadt-pcf-tent-v1'));
  const shader = {
    fragmentShader: '#include <shadowmap_pars_fragment>',
    vertexShader: '',
    uniforms: {},
  };
  first.onBeforeCompile(
    shader as Parameters<typeof first.onBeforeCompile>[0],
    {} as THREE.WebGLRenderer,
  );
  assert.equal(previousCalled, 1);
  assert.ok(shader.fragmentShader.endsWith('// custom material'));
  assert.ok(shader.fragmentShader.includes('Stable weighted PCF'));
  applyStableShadowFiltering(scene);
  assert.equal(first.version, afterFirstVersion);
  const late = new THREE.MeshStandardMaterial();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), late));
  applyStableShadowFiltering(scene);
  assert.ok(late.customProgramCacheKey().includes('neustadt-pcf-tent-v1'));
});

test('distinct preexisting shader callbacks retain distinct default keys while explicit keys remain dynamic', () => {
  const scene = new THREE.Scene(),
    a = new THREE.MeshStandardMaterial(),
    b = new THREE.MeshStandardMaterial(),
    custom = new THREE.MeshStandardMaterial();
  a.onBeforeCompile = (shader) => {
    shader.fragmentShader += '\n// terrain customization';
  };
  b.onBeforeCompile = (shader) => {
    shader.fragmentShader += '\n// road customization';
  };
  const keyA = a.customProgramCacheKey(),
    keyB = b.customProgramCacheKey();
  assert.notEqual(keyA, keyB);
  let variant = 'first';
  custom.customProgramCacheKey = () => variant;
  for (const material of [a, b, custom])
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  applyStableShadowFiltering(scene);
  assert.equal(a.customProgramCacheKey(), keyA + '|neustadt-pcf-tent-v1');
  assert.equal(b.customProgramCacheKey(), keyB + '|neustadt-pcf-tent-v1');
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
  assert.equal(custom.customProgramCacheKey(), 'first|neustadt-pcf-tent-v1');
  variant = 'second';
  assert.equal(custom.customProgramCacheKey(), 'second|neustadt-pcf-tent-v1');
});
