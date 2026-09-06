import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCity } from '../src/simulation.ts';
import { createCar } from '../src/models.ts';
import { CitizenRagdoll, createCitizenPhysicsWorld, createCitizens, createBuildingCollider, createGroundCollider, citizenSurfaceHeight, IMPACT_THRESHOLD, isGentleRelease, isCitizenIncidentWitnessed, MAX_CITIZENS, CITIZEN_SCALE, CITIZEN_PICK_RADIUS, MAX_HAND_SPEED } from '../src/citizens.ts';
import type { CitizenIncident } from '../src/types.ts';

function floor(world:CANNON.World,y=0):CANNON.Body {
  const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(10,1,10)),position:new CANNON.Vec3(0,y-1,0),collisionFilterGroup:1,collisionFilterMask:2});
  world.addBody(body);return body;
}
function step(world:CANNON.World,seconds:number):void {for(let i=0;i<seconds*120;i++)world.step(1/120);}
function city() {
  const state=createCity(91,true,40);
  for(const t of state.tiles){t.kind='empty';t.elevation=1;t.anchor=-1;t.level=0;}
  for(let x=5;x<20;x++){state.tiles[10*40+x].kind='road';state.tiles[11*40+x].kind='residential';state.tiles[11*40+x].level=2;}
  state.stats.population=1500;state.revision++;
  return state;
}

test('a citizen is six independent mass bodies with five angularly limited physical joints',()=>{
  const world=createCitizenPhysicsWorld(),doll=new CitizenRagdoll(world,{x:0,y:0,z:0});
  assert.equal(Object.values(doll.bodies).length,6);assert.equal(world.bodies.length,6);assert.equal(doll.constraints.length,5);
  for(const joint of doll.constraints){assert.ok(joint instanceof CANNON.ConeTwistConstraint);assert.ok(joint.angle>0&&joint.angle<Math.PI);assert.ok(joint.twistAngle>0&&joint.twistAngle<Math.PI);assert.equal(joint.collideConnected,false);}
  for(const body of Object.values(doll.bodies))assert.ok(body.mass>0);
  doll.dispose();assert.equal(world.bodies.length,0);assert.equal(world.constraints.length,0);
});

test('all miniature adults stay below .18 units including hats, fit the car scale, and have matching physics',()=>{
  const system=createCitizens(city()),meshes=system.group.children.filter((o):o is THREE.InstancedMesh=>o instanceof THREE.InstancedMesh&&o.name.startsWith('citizen-'));
  const matrix=new THREE.Matrix4(),scale=new THREE.Vector3(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion();
  const carSize=new THREE.Box3().setFromObject(createCar(0x718394)).getSize(new THREE.Vector3()),carLength=Math.max(carSize.x,carSize.z);
  for(let i=0;i<system.getDebug().count;i++) {
    const bounds=new THREE.Box3();let headWidth=0,shoulderWidth=0;
    for(const mesh of meshes) {
      mesh.getMatrixAt(i,matrix);mesh.geometry.computeBoundingBox();bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));
      matrix.decompose(position,quaternion,scale);
      if(mesh.name==='citizen-head')headWidth=scale.x;
      if(mesh.name==='citizen-torso')shoulderWidth=scale.x;
    }
    const height=bounds.max.y-bounds.min.y;
    assert.ok(height>=.15&&height<=.18,`Actor ${i} is ${height} units tall`);
    assert.ok(height<carLength*.6&&height>carLength*.4,`Adult height ${height} should be proportionate to car length ${carLength}`);
    assert.ok(headWidth/shoulderWidth<.75,'Adult heads must be narrower than the shoulders, not oversized bobbleheads');
  }
  const doll=new CitizenRagdoll(createCitizenPhysicsWorld(),{x:0,y:0,z:0});
  const physicalHeight=doll.bodies.head.position.y+(doll.bodies.head.shapes[0] as CANNON.Sphere).radius;
  assert.ok(physicalHeight>.15&&physicalHeight<.18,'Ragdoll collision geometry must shrink with the rendered person');
  assert.ok((doll.bodies.torso.shapes[0] as CANNON.Box).halfExtents.x*2<.06);
  assert.ok(CITIZEN_PICK_RADIUS>=.16&&CITIZEN_PICK_RADIUS<=.20,'Small actors must remain comfortable to pick');
  system.dispose();doll.dispose();
});

test('rounded resident details preserve instancing and a bounded triangle budget',()=>{
  const system=createCitizens(city()),meshes=system.group.children.filter((o):o is THREE.InstancedMesh=>o instanceof THREE.InstancedMesh&&o.name.startsWith('citizen-'));
  assert.equal(meshes.length,22,'Detailed ears and cuffs remain batched across every resident');
  const triangles=meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3,0);
  assert.ok(triangles<=4300,`Resident detail exceeded its shared geometry budget: ${triangles} triangles`);
  for(const name of ['head','hair','leftArm','leftShoe','leftHand','backpack']) {
    const mesh=system.group.getObjectByName(`citizen-${name}`) as THREE.InstancedMesh,normal=mesh.geometry.getAttribute('normal');
    let curved=false;
    for(let i=0;i<normal.count;i++)if([normal.getX(i),normal.getY(i),normal.getZ(i)].some(n=>Math.abs(n)>.05&&Math.abs(n)<.95)){curved=true;break;}
    assert.ok(curved,`${name} should have genuinely rounded geometry rather than flat cube faces`);
  }
  system.dispose();
});

test('lifted articulated bodies follow the physical hand and remain finite across 720 solver steps',()=>{
  const world=createCitizenPhysicsWorld();floor(world);
  const doll=new CitizenRagdoll(world,{x:0,y:.02,z:0});doll.hold({x:0,y:.02+.32*CITIZEN_SCALE,z:0});
  for(let i=0;i<720;i++){doll.move({x:Math.sin(i*.02)*.4,y:.8+Math.sin(i*.007)*.35,z:0});world.step(1/120);}
  assert.ok(doll.position.y>.3);
  for(const body of Object.values(doll.bodies))for(const value of [body.position.x,body.position.y,body.position.z,body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w])assert.ok(Number.isFinite(value));
  for(const joint of doll.constraints){const a=joint.bodyA.pointToWorldFrame(joint.pivotA),b=joint.bodyB.pointToWorldFrame(joint.pivotB);assert.ok(a.distanceTo(b)<.09,`Joint separated by ${a.distanceTo(b)}`);}
  doll.dispose();
});

test('an extreme pointer jump cannot pull joints apart or inject an explosive velocity',()=>{
  const world=createCitizenPhysicsWorld(),doll=new CitizenRagdoll(world,{x:0,y:0,z:0});doll.hold({x:0,y:.32*CITIZEN_SCALE,z:0});
  doll.move({x:12,y:9,z:0});let maxSeparation=0,maxSpeed=0;
  for(let i=0;i<260;i++) {
    world.step(1/120);
    for(const joint of doll.constraints)maxSeparation=Math.max(maxSeparation,joint.bodyA.pointToWorldFrame(joint.pivotA).distanceTo(joint.bodyB.pointToWorldFrame(joint.pivotB)));
    for(const body of Object.values(doll.bodies))maxSpeed=Math.max(maxSpeed,body.velocity.length());
  }
  assert.ok(maxSeparation<.025,`Stretched miniature joint: ${maxSeparation}`);assert.ok(maxSpeed<MAX_HAND_SPEED*1.35,`Unsafe drag energy: ${maxSpeed}`);
  assert.ok(Math.abs(doll.position.x-12)<.06);doll.dispose();
});

test('careful ground-level release is safe; a high or fast release is physical',()=>{
  assert.equal(isGentleRelease({x:0,y:1+.32*CITIZEN_SCALE,z:0},1,{x:0,y:0,z:0}),true);
  assert.equal(isGentleRelease({x:0,y:1.20,z:0},1,{x:.4,y:.2,z:0}),true);
  assert.equal(isGentleRelease({x:0,y:3,z:0},1,{x:0,y:0,z:0}),false);
  assert.equal(isGentleRelease({x:0,y:1+.32*CITIZEN_SCALE,z:0},1,{x:8,y:0,z:0}),false);
  const world=createCitizenPhysicsWorld();floor(world);let impacts=0;
  const doll=new CitizenRagdoll(world,{x:0,y:.025,z:0},0,CITIZEN_SCALE,()=>impacts++);doll.release({x:0,y:0,z:0});step(world,3);
  assert.equal(impacts,0);assert.ok(doll.position.y>-.1);doll.dispose();
});

test('a thrown citizen collides with ground exactly once and gives an outward contact normal',()=>{
  const world=createCitizenPhysicsWorld();floor(world);
  const impacts:{point:{x:number;y:number;z:number};normal:{x:number;y:number;z:number};speed:number}[]=[];
  const doll=new CitizenRagdoll(world,{x:0,y:3,z:0},0,CITIZEN_SCALE,hit=>impacts.push(hit));doll.release({x:0,y:-9,z:0});step(world,3);
  assert.equal(impacts.length,1);assert.ok(impacts[0].speed>=IMPACT_THRESHOLD);assert.ok(impacts[0].normal.y>.9);assert.ok(Math.abs(impacts[0].point.y)<.001);doll.dispose();
});

test('fast sideways throws hit walls and report a vertical-surface normal',()=>{
  const world=createCitizenPhysicsWorld();floor(world);
  world.addBody(new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(.25,3,3)),position:new CANNON.Vec3(1,2,0),collisionFilterGroup:1,collisionFilterMask:2}));
  const normals:{x:number;y:number;z:number}[]=[];
  const doll=new CitizenRagdoll(world,{x:-1,y:1,z:0},0,CITIZEN_SCALE,hit=>normals.push(hit.normal));doll.release({x:12,y:0,z:0});step(world,1);
  assert.equal(normals.length,1);assert.ok(normals[0].x<-.9);doll.dispose();
});

test('nearby pedestrians and police witness incidents, an isolated abduction stays unwitnessed',()=>{
  const origin={x:0,y:0,z:0};
  assert.equal(isCitizenIncidentWitnessed(origin,[{x:4,y:0,z:2}],[]),true);
  assert.equal(isCitizenIncidentWitnessed(origin,[{x:9,y:0,z:2}],[]),false);
  assert.equal(isCitizenIncidentWitnessed(origin,[],[{x:6,y:0,z:0}]),true);
  assert.equal(isCitizenIncidentWitnessed(origin,[],[]),false);
});

test('ground and authored building colliders respect elevated terrain and actual upgraded height',()=>{
  const state=city(),tile=state.tiles[11*40+8];tile.elevation=3;tile.kind='commercial';tile.level=3;
  const terrain=createGroundCollider(state,8,11);assert.ok(Math.abs(terrain.position.y+8-3)<.001);
  const building=createBuildingCollider(state,tile);assert.ok(building);assert.equal(building.position.y,3);assert.ok(building.shapes.some(shape=>(shape as CANNON.Box).halfExtents.y>.3));
  tile.kind='park';assert.equal(createBuildingCollider(state,tile),null);
});

test('instanced crowds spawn near city streets, vary their clothing, and obey pause',()=>{
  const state=city(),system=createCitizens(state);const before=system.getDebug();
  assert.ok(before.count>=24&&before.count<=MAX_CITIZENS);assert.equal(before.ragdolls,0);
  assert.ok(system.group.children.filter(c=>c instanceof THREE.InstancedMesh).length<=23,'At most twenty-two crowd meshes plus one particle mesh');
  const shirt=system.group.getObjectByName('citizen-torso') as THREE.InstancedMesh;
  assert.ok(shirt.instanceColor);assert.ok(new Set(Array.from(shirt.instanceColor.array)).size>8);
  for(let i=0;i<10;i++)system.animate(.03,false);assert.deepEqual(system.getDebug().positions,before.positions);
  for(let i=0;i<30;i++)system.animate(.03,true);assert.notDeepEqual(system.getDebug().positions,before.positions);system.dispose();
});

test('picking, lifting, careful put-down and cancellation never emit an incident',()=>{
  const state=city(),incidents:unknown[]=[],system=createCitizens(state,i=>incidents.push(i));system.setEnabled(true);
  const p=system.getDebug().positions[0],ray=new THREE.Ray(new THREE.Vector3(p.x,p.y+.32*CITIZEN_SCALE,p.z-10),new THREE.Vector3(0,0,1));
  assert.equal(system.pointerDown(ray,new THREE.Vector3(0,-.7,.7),0),true);assert.equal(system.holding,true);assert.equal(system.cursor,'grabbing');
  assert.equal(system.pointerUp(200),true);assert.equal(system.getDebug().ragdolls,0);assert.equal(incidents.length,0);
  assert.equal(system.pointerDown(ray,new THREE.Vector3(0,-.7,.7),300),true);
  system.pointerMove(new THREE.Ray(new THREE.Vector3(p.x,p.y+3,p.z-10),new THREE.Vector3(0,0,1)),350);
  for(let i=0;i<30;i++)system.animate(.016,true);
  system.cancel();assert.equal(system.holding,false);assert.equal(system.getDebug().ragdolls,0);assert.equal(incidents.length,0);system.dispose();
});

test('persisted floor and wall splatters recreate with correct world positions and orientations',()=>{
  const state=city();
  state.citizenEffects.incidents=[
    {id:1,month:0,x:10.5,y:1.06,z:10.5,nx:0,ny:1,nz:0,witnessed:true,kind:'impact'},
    {id:2,month:0,x:11.9,y:1.9,z:10.5,nx:-1,ny:0,nz:0,witnessed:true,kind:'impact'},
    {id:3,month:0,x:0,y:1,z:10,nx:0,ny:1,nz:0,witnessed:false,kind:'abduction'},
  ] satisfies CitizenIncident[];
  const system=createCitizens(state),marks=system.group.getObjectByName('persistent-citizen-splatters')!;
  assert.equal(marks.children.length,2);assert.ok(Math.abs(marks.children[0].position.x+9.5)<.001);
  const wallNormal=new THREE.Vector3(0,0,1).applyQuaternion(marks.children[1].quaternion);assert.ok(wallNormal.x<-.99);
  system.update(state);assert.equal(marks.children.length,2);system.dispose();
});

test('impact stains have small irregular dark droplets and conform closely to the actual pavement',()=>{
  const state=city();state.citizenEffects.incidents=[{id:17,month:0,x:10.5,y:1.0455,z:10.5,nx:0,ny:1,nz:0,witnessed:true,kind:'impact'}];
  const system=createCitizens(state),stain=system.group.getObjectByName('citizen-splatter-17') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  assert.ok(stain);assert.equal(stain.material.color.getHex(),0x752b2a);assert.equal(stain.material.emissive.getHex(),0);
  const vertices=stain.geometry.getAttribute('position'),worldPoint=new THREE.Vector3();assert.ok(vertices.count>120&&vertices.count<1000,'Many fine droplets should be batched in one small mesh');
  stain.updateMatrixWorld(true);let radius=0;
  for(let i=0;i<vertices.count;i++) {
    worldPoint.fromBufferAttribute(vertices,i).applyMatrix4(stain.matrixWorld);radius=Math.max(radius,Math.hypot(worldPoint.x-stain.position.x,worldPoint.z-stain.position.z));
    assert.ok(Math.abs(worldPoint.y-citizenSurfaceHeight(state,worldPoint.x,worldPoint.z)-.0012)<.00001,'The stain must sit on the visible surface without floating');
  }
  assert.ok(radius>.07&&radius<.18,`Stain extent ${radius} must be proportional to miniature residents`);system.dispose();
});

test('an off-centre stationary grab has no phantom throw velocity or casualty',()=>{
  const state=city();state.stats.population=1;
  const incidents:unknown[]=[],system=createCitizens(state,i=>incidents.push(i));system.setEnabled(true);
  const p=system.getDebug().positions[0],ray=new THREE.Ray(new THREE.Vector3(p.x+CITIZEN_PICK_RADIUS*.8,p.y+.32*CITIZEN_SCALE,p.z-10),new THREE.Vector3(0,0,1));
  assert.equal(system.pointerDown(ray,new THREE.Vector3(0,-.7,.7),0),true);
  system.pointerMove(ray,16);system.pointerUp(17);
  for(let i=0;i<180;i++)system.animate(1/60,false);
  assert.equal(incidents.length,0);assert.equal(system.getDebug().count,1);assert.equal(system.getDebug().ragdolls,0);system.dispose();
});

test('a very high upward throw remains airborne until a real impact rather than timing out',()=>{
  const world=createCitizenPhysicsWorld();floor(world);let impacts=0;
  const doll=new CitizenRagdoll(world,{x:0,y:50,z:0},0,CITIZEN_SCALE,()=>impacts++);doll.release({x:0,y:MAX_HAND_SPEED,z:0});step(world,3.51);
  assert.equal(doll.resting,false);assert.equal(impacts,0);assert.ok(doll.position.y>30);
  step(world,8);assert.equal(impacts,1);doll.dispose();
});

test('loading another same-size city removes held actors and cannot apply an old throw to it',()=>{
  const state=city(),incidents:unknown[]=[],system=createCitizens(state,i=>incidents.push(i));system.setEnabled(true);
  const p=system.getDebug().positions[0],ray=new THREE.Ray(new THREE.Vector3(p.x,p.y+.32*CITIZEN_SCALE,p.z-10),new THREE.Vector3(0,0,1));
  assert.equal(system.pointerDown(ray,new THREE.Vector3(0,-.7,.7),0),true);
  system.pointerMove(new THREE.Ray(new THREE.Vector3(p.x,p.y+3,p.z-10),new THREE.Vector3(0,0,1)),100);
  for(let i=0;i<20;i++)system.animate(.016,true);
  const empty=createCity(193,true,40);system.update(empty);
  assert.equal(system.holding,false);assert.equal(system.getDebug().count,0);assert.equal(system.getDebug().ragdolls,0);
  for(let i=0;i<200;i++)system.animate(.016,true);
  assert.equal(incidents.length,0);system.dispose();
});

test('stadium fields and airport runways are not enclosed by invisible facility boxes',()=>{
  const state=city();
  const inside=(body:CANNON.Body,p:CANNON.Vec3)=>body.shapes.some((shape,i)=>{
    const offset=body.shapeOffsets[i],half=(shape as CANNON.Box).halfExtents;
    return Math.abs(p.x-offset.x)<=half.x&&Math.abs(p.y-offset.y)<=half.y&&Math.abs(p.z-offset.z)<=half.z;
  });
  const stadium={...state.tiles[20*40+20],kind:'stadium' as const,level:1,anchor:20*40+20,rotation:0 as const};
  const stadiumBody=createBuildingCollider(state,stadium);assert.ok(stadiumBody);assert.ok(stadiumBody.shapes.length>4);
  assert.equal(inside(stadiumBody,new CANNON.Vec3(2.5,.8,2)),false);
  assert.equal(inside(stadiumBody,new CANNON.Vec3(2.5,.135,2)),true,'The playing surface itself still catches a falling citizen');
  const airport={...stadium,kind:'airport' as const};
  const airportBody=createBuildingCollider(state,airport);assert.ok(airportBody);
  assert.equal(inside(airportBody,new CANNON.Vec3(4.5,.8,.9)),false);
  assert.equal(inside(airportBody,new CANNON.Vec3(4.5,.095,.9)),true,'The runway pavement itself must collide');
});

test('residents hidden behind a building cannot be picked through its walls',()=>{
  const state=city();state.stats.population=1;
  const system=createCitizens(state);system.setEnabled(true);const p=system.getDebug().positions[0];
  const blocked=new THREE.Ray(new THREE.Vector3(p.x,p.y+.32*CITIZEN_SCALE,p.z+10),new THREE.Vector3(0,0,-1));
  assert.equal(system.pointerDown(blocked,new THREE.Vector3(0,-.7,-.7),0),false);
  const visible=new THREE.Ray(new THREE.Vector3(p.x,p.y+.32*CITIZEN_SCALE,p.z-10),new THREE.Vector3(0,0,1));
  assert.equal(system.pointerDown(visible,new THREE.Vector3(0,-.7,.7),0),true);system.dispose();
});
