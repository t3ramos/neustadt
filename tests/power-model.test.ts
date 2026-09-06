import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCity, recalculate } from '../src/simulation.ts';
import { getPowerLayout } from '../src/power-layout.ts';
import { createPowerGridModel, powerWirePoints } from '../src/power-model.ts';
import { createPathTracingSnapshot } from '../src/raytracing.ts';

function smallGrid(){
  const state=createCity(19,true,40);
  for(const tile of state.tiles){tile.kind='empty';tile.elevation=0;tile.level=0;tile.anchor=-1;tile.hasPowerLine=false;tile.hasPipe=false;}
  for(let x=8;x<=15;x++){const tile=state.tiles[10*40+x];tile.kind='road';tile.hasPowerLine=true;}
  const source=state.tiles[11*40+8];source.kind='power';source.level=1;
  const home=state.tiles[11*40+14];home.kind='residential';home.level=2;
  recalculate(state);return state;
}

test('sagging wire vertices touch both actual insulators and remain below the straight span',()=>{
  const start=new THREE.Vector3(1,3.385,4),end=new THREE.Vector3(3,1.245,4.36);
  const points=powerWirePoints(start,end,.15);
  assert.equal(points.length,7);assert.ok(points[0].equals(start));assert.ok(points.at(-1)!.equals(end));
  for(let i=1;i<points.length-1;i++){
    const t=i/(points.length-1),straight=start.clone().lerp(end,t);
    assert.ok(points[i].y<straight.y);assert.equal(points[i].x,straight.x);assert.equal(points[i].z,straight.z);
  }
  assert.ok(Math.abs(points[3].y-(start.y+end.y)/2+.15)<1e-9);
});

test('connected poles, meters and wires merge into a small finite PBR mesh set',()=>{
  const state=smallGrid(),layout=getPowerLayout(state),group=createPowerGridModel(state,layout);
  assert.ok(layout.services.some(s=>state.tiles[s.building].kind==='power'));
  assert.ok(layout.services.some(s=>state.tiles[s.building].kind==='residential'));
  assert.deepEqual(group.userData.utilityCounts,{poles:layout.poles.length,spans:layout.spans.length,services:layout.services.length});
  assert.ok(group.children.length<=8);assert.ok(group.children.length>=4);
  for(const item of group.children){
    assert.ok(item instanceof THREE.Mesh);assert.ok(item.material instanceof THREE.MeshStandardMaterial);
    const positions=item.geometry.getAttribute('position');assert.ok(positions.count>0);
    assert.ok(item.geometry.getAttribute('normal'));assert.ok(item.geometry.getAttribute('uv'));
    for(const value of positions.array)assert.ok(Number.isFinite(value));
    item.geometry.computeBoundingBox();assert.ok(item.geometry.boundingBox!.min.y>=-.002);
  }
});

test('new electricity geometry survives the actual ray-tracing snapshot path',async()=>{
  const state=smallGrid(),scene=new THREE.Scene();scene.add(createPowerGridModel(state,getPowerLayout(state)));
  const snapshot=await createPathTracingSnapshot(scene,false);
  const meshes=snapshot.scene.children.filter(o=>o instanceof THREE.Mesh);
  assert.ok(meshes.length>=4&&meshes.length<=8);
  for(const mesh of meshes){assert.ok(mesh.geometry.getAttribute('normal'));assert.equal(mesh.geometry.getAttribute('color').itemSize,4);}
  snapshot.dispose();
});
