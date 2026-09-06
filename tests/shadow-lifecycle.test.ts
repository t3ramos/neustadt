import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLUniforms } from 'three/src/renderers/webgl/WebGLUniforms.js';
import { createCityLighting, reflectionShadowsReady } from '../src/lighting.ts';

test('actual Three PCF array fallback requires a populated comparison shadow map',()=>{
  const sampled:THREE.Texture[]=[];
  const gl={SAMPLER_2D_SHADOW:0x8b62,ACTIVE_UNIFORMS:0x8b86,getProgramParameter:()=>1,
    getActiveUniform:()=>({name:'directionalShadowMap[0]',size:1,type:0x8b62}),getUniformLocation:()=>({}),uniform1iv:()=>{}};
  const uniforms=new WebGLUniforms(gl as unknown as WebGLRenderingContext,{} as never) as unknown as {setValue:(gl:unknown,name:string,value:unknown,textures:unknown)=>void};
  const textures={allocateTextureUnit:()=>0,setTexture2D:(texture:THREE.Texture)=>sampled.push(texture)};
  uniforms.setValue(gl,'directionalShadowMap',[null],textures);
  assert.equal(sampled.length,1);
  const fallback=sampled[0] as THREE.DepthTexture;
  assert.equal(fallback.isDepthTexture,true);
  assert.equal(fallback.version,0,'The fallback has not been uploaded to the GPU');
  assert.equal(fallback.compareFunction,null,'The installed array fallback cannot satisfy sampler2DShadow');
});

test('shadow resize invalidates reflection readiness until a valid PCF comparison target is restored',()=>{
  const scene=new THREE.Scene(),sun=new THREE.DirectionalLight();sun.castShadow=true;scene.add(sun);
  const renderer={shadowMap:{enabled:true,type:THREE.PCFShadowMap}} as THREE.WebGLRenderer;
  assert.equal(reflectionShadowsReady(renderer,scene),false);
  const first=new THREE.WebGLRenderTarget(2048,2048);first.depthTexture=new THREE.DepthTexture(2048,2048);first.depthTexture.compareFunction=THREE.LessEqualCompare;sun.shadow.map=first;
  assert.equal(reflectionShadowsReady(renderer,scene),true);
  first.dispose();sun.shadow.map=null;sun.shadow.mapSize.set(4096,4096);
  assert.equal(reflectionShadowsReady(renderer,scene),false);
  const second=new THREE.WebGLRenderTarget(4096,4096);second.depthTexture=new THREE.DepthTexture(4096,4096);sun.shadow.map=second;
  assert.equal(reflectionShadowsReady(renderer,scene),false,'A plain depth target still cannot satisfy the PCF comparison sampler');
  second.depthTexture.compareFunction=THREE.LessEqualCompare;
  assert.equal(reflectionShadowsReady(renderer,scene),true);
  second.depthTexture.compareFunction=THREE.GreaterEqualCompare;
  assert.equal(reflectionShadowsReady(renderer,scene),true,'Reversed depth comparison is valid as well');
  second.dispose();
});

test('sky filtering waits without rendering when quality-switch shadow maps are absent',()=>{
  const scene=new THREE.Scene(),sunlight=new THREE.DirectionalLight(),ambient=new THREE.HemisphereLight(),fill=new THREE.DirectionalLight();
  sunlight.castShadow=true;scene.add(sunlight,ambient,fill);
  let renders=0;
  const renderer={toneMappingExposure:1,shadowMap:{enabled:true,type:THREE.PCFShadowMap,autoUpdate:true,needsUpdate:true},getContext:()=>({isContextLost:()=>false}),render:()=>{renders++;}} as unknown as THREE.WebGLRenderer;
  const lighting=createCityLighting({scene,renderer,sunlight,ambient,fill,worldSize:128});
  lighting.setQuality('ultra');
  lighting.refreshReflections(new THREE.Vector3(),true);
  assert.equal(renders,0);
  assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.shadowMap.needsUpdate,true);
  lighting.dispose();
});

test('disabled shadows and invisible lights do not unnecessarily block sky environment initialization',()=>{
  const scene=new THREE.Scene(),sun=new THREE.DirectionalLight();sun.castShadow=true;scene.add(sun);
  const renderer={shadowMap:{enabled:false,type:THREE.PCFShadowMap}} as THREE.WebGLRenderer;
  assert.equal(reflectionShadowsReady(renderer,scene),true);
  renderer.shadowMap.enabled=true;sun.visible=false;
  assert.equal(reflectionShadowsReady(renderer,scene),true);
});
