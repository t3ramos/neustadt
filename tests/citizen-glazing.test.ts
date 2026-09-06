import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CITIZEN_PHYSICS_STEP, CITIZEN_SCALE, CitizenRagdoll, createBuildingCollider, createCitizenPhysicsWorld, createCitizens, IMPACT_THRESHOLD, MAX_HAND_SPEED } from '../src/citizens.ts';
import { createTileModel } from '../src/models.ts';
import { applyCitizenIncident, createCity, deserializeCity, recalculate, serializeCity } from '../src/simulation.ts';
import type { CityState, Tile } from '../src/types.ts';

type Axis='x'|'z';
type Hit={point:{x:number;y:number;z:number};normal:{x:number;y:number;z:number};speed:number};

function facadeCity():{state:CityState;tile:Tile} {
  const state=createCity(91,true,40);
  for(const tile of state.tiles) {
    tile.kind='empty';tile.elevation=1;tile.anchor=-1;tile.level=0;tile.fire=0;
    tile.hasPipe=false;tile.hasPowerLine=false;
  }
  const home=state.tiles[5*state.size+5];home.kind='residential';home.level=1;
  const tile=state.tiles[20*state.size+20];tile.kind='commercial';tile.level=3;tile.variation=0;
  recalculate(state);
  return {state,tile};
}

/** Raycast an unobstructed authored wall, not the bounding box of its decorations. */
function exteriorFacade(state:CityState,tile:Tile,axis:Axis,sign:number):{point:THREE.Vector3;normal:THREE.Vector3} {
  const model=createTileModel(tile,state);
  model.position.set(tile.x-state.size/2+.5,tile.elevation,tile.z-state.size/2+.5);model.updateMatrixWorld(true);
  const structures:{mesh:THREE.Mesh;bounds:THREE.Box3;volume:number}[]=[];
  model.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||object.geometry.type!=='BoxGeometry')return;
    const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3());
    if(size.y>.35&&size.x>.16&&size.z>.16)structures.push({mesh:object,bounds,volume:size.x*size.y*size.z});
  });
  structures.sort((a,b)=>b.volume-a.volume);
  const tangent:Axis=axis==='x'?'z':'x',normal=new THREE.Vector3();normal[axis]=sign;
  const raycaster=new THREE.Raycaster(),direction=normal.clone().negate(),normalMatrix=new THREE.Matrix3();
  const cast=(point:THREE.Vector3)=>{
    const origin=point.clone();origin[axis]+=sign*3;raycaster.set(origin,direction);
    return raycaster.intersectObject(model,true)[0];
  };
  for(const structure of structures)for(const height of [.5,.4,.6,.3,.7])for(const offset of [0,-.25,.25,-.4,.4]) {
    const point=structure.bounds.getCenter(new THREE.Vector3()),size=structure.bounds.getSize(new THREE.Vector3());
    point.y=structure.bounds.min.y+size.y*height;point[tangent]+=size[tangent]*offset;
    const hit=cast(point);
    if(!hit||hit.object!==structure.mesh||!hit.face)continue;
    const hitNormal=hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    if(hitNormal.dot(normal)<.99)continue;
    // The entire miniature adult must approach a wall section free of projecting
    // floor plates, signs or window trim, not merely one unobstructed ray.
    const clear=[[-.115,0],[.09,0],[0,-.045],[0,.045]].every(([dy,side])=>{
      const probe=point.clone();probe.y+=dy;probe[tangent]+=side;
      const nearby=cast(probe);
      return nearby?.object===structure.mesh&&Math.abs(nearby.point[axis]-hit.point[axis])<.0001;
    });
    if(clear)return {point:hit.point,normal:hitNormal};
  }
  assert.fail(`Commercial fixture has no clear ${sign>0?'+':'−'}${axis} structural facade for a physical throw`);
}

for(const [axis,sign] of [['x',1],['x',-1],['z',1],['z',-1]] as const)for(const distance of [.600,.602,.618,.638]) {
  test(`a ragdoll thrown from ${distance}m strikes the ${sign>0?'+':'−'}${axis} visible building facade and its saved stain stays on that surface`,()=>{
    const {state,tile}=facadeCity(),{point:target,normal}=exteriorFacade(state,tile,axis,sign);
    const outerFace=target[axis];
    const origin=target.clone().addScaledVector(normal,distance);origin.y-=.32*CITIZEN_SCALE;
    const velocity=normal.clone().multiplyScalar(-MAX_HAND_SPEED),world=createCitizenPhysicsWorld(),building=createBuildingCollider(state,tile);
    assert.ok(building);world.addBody(building);
    const hits:Hit[]=[];
    const ragdoll=new CitizenRagdoll(world,origin,0,CITIZEN_SCALE,hit=>hits.push(hit));
    try {
      ragdoll.release(velocity);
      for(let elapsed=0;elapsed<1;elapsed+=CITIZEN_PHYSICS_STEP)world.step(CITIZEN_PHYSICS_STEP);
      assert.equal(hits.length,1,'An outer facade throw must register exactly one impact');
      const hit=hits[0],hitNormal=new THREE.Vector3(hit.normal.x,hit.normal.y,hit.normal.z);
      assert.ok(hit.speed>=IMPACT_THRESHOLD);
      assert.ok(hitNormal.dot(normal)>.99,`Contact normal must face outward from the raycast facade; hit=${JSON.stringify(hit)}, target=${JSON.stringify(target)}`);
      assert.ok(Math.abs(hit.point[axis]-outerFace)<.0001,
        `Impact hit ${hit.point[axis]} instead of the raycast exterior face ${outerFace}; the citizen passed through the wall or hit an expanded outer collider`);

      const before=state.stats.population;
      const applied=applyCitizenIncident(state,{
        x:hit.point.x+state.size/2,y:hit.point.y,z:hit.point.z+state.size/2,
        nx:hit.normal.x,ny:hit.normal.y,nz:hit.normal.z,witnessed:false,kind:'impact',
      });
      assert.equal(applied.ok,true);assert.equal(state.stats.population,before-1);
      const restored=deserializeCity(serializeCity(state)),incident=restored.citizenEffects.incidents[0];
      assert.ok(Math.abs(incident[axis]-state.size/2-outerFace)<.0001,
        'The saved impact point must remain on the visible building facade');
      const citizens=createCitizens(restored);
      try {
        const marks=citizens.group.getObjectByName('persistent-citizen-splatters')!;
        assert.equal(marks.children.length,1);
        const mark=marks.children[0],markNormal=new THREE.Vector3(0,0,1).applyQuaternion(mark.quaternion);
        assert.ok(markNormal.dot(normal)>.99);
        assert.ok(Math.abs(mark.position[axis]-outerFace)<.003,
          'Restored decal should sit immediately on the visible facade');
      } finally {citizens.dispose();}
    } finally {ragdoll.dispose();world.removeBody(building);}
  });
}
