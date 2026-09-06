import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ANIMAL_LIMITS, createAnimalSystem, type AnimalSpecies } from '../src/animals.ts';
import { createCity } from '../src/simulation.ts';
import { sampleGroundHeight } from '../src/terrain-graphics.ts';
import type { CityState } from '../src/types.ts';

const tileAt=(state:CityState,x:number,z:number)=>state.tiles[Math.floor(z+state.size/2)*state.size+Math.floor(x+state.size/2)];
const distance=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
const neighbors=(state:CityState,x:number,z:number,radius:number)=>state.tiles.filter(t=>Math.max(Math.abs(t.x-Math.floor(x+state.size/2)),Math.abs(t.z-Math.floor(z+state.size/2)))<=radius);

test('a populated region gets only a handful of pets and localized woodland animals, deterministically',()=>{
  const state=createCity(2026),a=createAnimalSystem(state),b=createAnimalSystem(createCity(2026));
  assert.deepEqual(a.getDebug(),b.getDebug());
  assert.ok(a.getDebug().count>5&&a.getDebug().count<=15);
  for(const [species,limit] of Object.entries(ANIMAL_LIMITS))assert.ok(a.getDebug().counts[species as AnimalSpecies]<=limit);
  for(const p of a.getDebug().positions) {
    const tile=tileAt(state,p.x,p.z);assert.ok(['empty','tree','park'].includes(tile.kind));assert.ok(tile.elevation>=0);
    if(p.species==='cat'||p.species==='dog')assert.ok(neighbors(state,p.x,p.z,4).some(t=>t.kind==='residential'&&t.level>0),'pets stay in occupied neighborhoods');
    else {
      assert.ok(neighbors(state,p.x,p.z,3).filter(t=>t.kind==='tree').length>=4);
      assert.ok(neighbors(state,p.x,p.z,3).every(t=>['empty','tree','water','rubble'].includes(t.kind)),'wildlife stays away from developed lots and traffic');
    }
  }
  for(const species of ['deer','rabbit'] as const){const group=a.getDebug().positions.filter(p=>p.species===species);assert.ok(group.every(p=>distance(p,group[0])<=6));}
  a.dispose();b.dispose();
});

test('barren empty land and all-water regions do not spontaneously create animals',()=>{
  const state=createCity(2026,true),system=createAnimalSystem(state);assert.equal(system.getDebug().count,0);
  for(const tile of state.tiles){tile.kind='water';tile.elevation=-1;}system.update(state);assert.equal(system.getDebug().count,0);assert.equal(system.group.children.length,0);system.dispose();
});

test('animals visibly wander while their feet stay on valid habitat and clear of roads, water and buildings',()=>{
  const state=createCity(802),system=createAnimalSystem(state),before=system.getDebug().positions;
  let movedFrames=0;
  for(let frame=0;frame<1000;frame++) {
    system.animate(.05,frame*.05);
    if(frame%10!==0)continue;
    for(const p of system.getDebug().positions) {
      const tile=tileAt(state,p.x,p.z);assert.ok(['empty','tree','park'].includes(tile.kind));assert.ok(tile.elevation>=0);
      const ground=Math.max(0,sampleGroundHeight(state,p.x,p.z))+(tile.kind==='park'?.043:.003);
      assert.ok(Math.abs(p.y-ground)<.00001);
      if(tile.kind==='tree')assert.ok(Math.hypot(p.x-(tile.x-state.size/2+.5),p.z-(tile.z-state.size/2+.5))>=.25);
      if(p.moving)movedFrames++;
    }
  }
  assert.ok(movedFrames>30);assert.ok(system.getDebug().positions.filter(p=>distance(p,before.find(b=>b.id===p.id)!)>.1).length>=6);
  system.dispose();
});

test('park pets use the open cross paths rather than benches, flowerbeds or tree corners',()=>{
  const state=createCity(84,true,40);
  for(const tile of state.tiles){tile.kind='empty';tile.elevation=0;tile.level=0;}
  for(let z=12;z<=15;z++)for(let x=12;x<=15;x++)state.tiles[z*40+x].kind='park';
  for(let z=11;z<=16;z++){const t=state.tiles[z*40+11];t.kind='residential';t.level=1;}
  const system=createAnimalSystem(state);assert.ok(system.getDebug().count>0);
  for(let frame=0;frame<500;frame++) {
    system.animate(.05,frame*.05);
    for(const p of system.getDebug().positions){const t=tileAt(state,p.x,p.z);if(t.kind==='park')assert.ok(Math.min(Math.abs(p.x-(t.x-19.5)),Math.abs(p.z-(t.z-19.5)))<=.047);}
  }
  system.dispose();
});

test('nearby driving frightens an animal away without creating collision objects',()=>{
  const state=createCity(2026),system=createAnimalSystem(state),animal=system.getDebug().positions.find(p=>p.species==='deer')!;
  const vehicle={x:animal.x+.4,z:animal.z+.1,speed:1};system.setVehicle(vehicle);
  for(let i=0;i<45;i++)system.animate(.05,i*.05);
  const after=system.getDebug().positions.find(p=>p.id===animal.id)!;
  assert.ok(distance(after,vehicle)>distance(animal,vehicle)+.15);assert.equal(after.fleeing,true);
  assert.ok(system.group.children.every(child=>child instanceof THREE.InstancedMesh));
  system.setVehicle(null);system.animate(.05,3);assert.equal(system.getDebug().positions.find(p=>p.id===animal.id)!.fleeing,false);system.dispose();
});

test('animal geometry stays tiny next to citizens, with rounded detailed forms and three draw calls total',()=>{
  const system=createAnimalSystem(createCity()),debug=system.getDebug();assert.equal(debug.drawCalls,3);assert.ok(debug.instances<500);
  const matrix=new THREE.Matrix4(),center=new THREE.Vector3();
  for(const species of ['cat','dog','deer','rabbit'] as const) {
    const animal=debug.positions.find(p=>p.species===species)!;assert.ok(animal);
    const bounds=new THREE.Box3();let components=0;
    for(const item of system.group.children) {
      const mesh=item as THREE.InstancedMesh;mesh.geometry.computeBoundingBox();
      assert.ok(mesh.geometry.getAttribute('position').count>20);
      for(let i=0;i<mesh.count;i++) {
        mesh.getMatrixAt(i,matrix);center.setFromMatrixPosition(matrix);
        if(Math.hypot(center.x-animal.x,center.z-animal.z)>.2)continue;
        bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));components++;
      }
    }
    assert.ok(components>=20,'rounded muzzles, ears, paws and tails remain separate model details');
    const size=bounds.getSize(new THREE.Vector3());
    assert.ok(size.y>({cat:.05,dog:.065,deer:.16,rabbit:.045})[species]);
    assert.ok(size.y<({cat:.069,dog:.094,deer:.215,rabbit:.07})[species]);
    assert.ok(size.x<.16&&size.z<.25);
  }
  system.dispose();
});

test('construction rebuilds habitats without mutating the saved city or reallocating shared geometry/materials',()=>{
  const state=createCity(301),before=JSON.stringify(state),system=createAnimalSystem(state),first=system.group.children as THREE.InstancedMesh[];
  const geometries=first.map(mesh=>mesh.geometry),material=first[0].material;
  assert.equal(JSON.stringify(state),before);
  const cat=system.getDebug().positions.find(p=>p.species==='cat')!,tile=tileAt(state,cat.x,cat.z);tile.kind='commercial';tile.level=3;
  system.update(state);assert.ok(system.getDebug().positions.every(p=>tileAt(state,p.x,p.z).kind!=='commercial'));
  assert.ok(system.group.children.every((mesh,i)=>(mesh as THREE.InstancedMesh).geometry===geometries[i]&&(mesh as THREE.InstancedMesh).material===material));
  const stable=system.getDebug();state.money+=1;state.month+=1;state.revision++;system.update(state);assert.deepEqual(system.getDebug(),stable);
  let geometryDisposals=0,materialDisposals=0;for(const geometry of geometries)geometry.addEventListener('dispose',()=>geometryDisposals++);
  assert.ok(!Array.isArray(material));material.addEventListener('dispose',()=>materialDisposals++);
  system.dispose();system.dispose();assert.equal(geometryDisposals,3);assert.equal(materialDisposals,1);assert.equal(system.getDebug().count,0);assert.equal(system.group.children.length,0);
});

test('a paused simulation holds animal positions while harmless idle rendering and observations remain available',()=>{
  const state=createCity();state.speed=0;const system=createAnimalSystem(state),before=system.getDebug().positions;
  for(let i=0;i<100;i++)system.animate(.05,i*.05);
  assert.deepEqual(system.getDebug().positions,before);assert.equal(system.getObservations().length,before.length);
  const observations=system.getObservations();observations[0].x=10000;assert.notEqual(system.getObservations()[0].x,10000);
  system.dispose();
});
