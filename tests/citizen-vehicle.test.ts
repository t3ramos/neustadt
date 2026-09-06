import assert from 'node:assert/strict';
import test from 'node:test';
import { createCitizens, SEVERE_VEHICLE_IMPACT_SPEED, sweepVehicleFootprint, type CitizenSystem, type CitizenVehicleSweep } from '../src/citizens.ts';
import { applyCitizenIncident, createCity, recalculate } from '../src/simulation.ts';
import type { CitizenIncident, CityState } from '../src/types.ts';

type Point={x:number;y:number;z:number};
type Incident=Omit<CitizenIncident,'id'|'month'>;

function roadCity(population=1):CityState {
  const state=createCity(91,true,40);
  for(const tile of state.tiles) {
    tile.kind='empty';tile.elevation=1;tile.anchor=-1;tile.level=0;tile.fire=0;
    tile.hasPipe=false;tile.hasPowerLine=false;
  }
  for(let x=8;x<=12;x++) {
    state.tiles[10*state.size+x].kind='road';
    const home=state.tiles[11*state.size+x];home.kind='residential';home.level=1;
  }
  recalculate(state);state.citizenEffects.populationLoss=state.stats.population-population;recalculate(state);
  assert.equal(state.stats.population,population);
  return state;
}

function advance(system:CitizenSystem,seconds:number,walking=false):void {
  const frames=Math.ceil(seconds*60),dt=seconds/frames;
  for(let frame=0;frame<frames;frame++)system.animate(dt,walking);
}

function passingCar(position:Point,speed:number,lateralOffset=0):CitizenVehicleSweep {
  return {
    previous:{x:position.x-.4,y:position.y,z:position.z+lateralOffset},
    current:{x:position.x+.4,y:position.y,z:position.z+lateralOffset},
    yaw:Math.PI/2,width:.18,length:.34,height:.18,
    velocity:{x:speed,y:0,z:0},vehicleId:41,
  };
}

test('vehicle sweeps catch a pedestrian between two non-overlapping endpoints',()=>{
  const event:CitizenVehicleSweep={previous:{x:-2,y:0,z:0},current:{x:2,y:0,z:0},yaw:Math.PI/2,width:.2,length:.8,height:.18,velocity:{x:4,y:0,z:0},vehicleId:1};
  const person={x:0,y:.09,z:0};
  assert.equal(sweepVehicleFootprint(person,{...event,current:event.previous}),null);
  assert.equal(sweepVehicleFootprint(person,{...event,previous:event.current}),null);
  const hit=sweepVehicleFootprint(person,event);
  assert.ok(hit);assert.ok(Math.abs(hit.time-.39375)<1e-8);
  assert.ok(hit.normal.x>.99);assert.ok(Math.abs(hit.normal.y)<1e-8);assert.ok(Math.abs(hit.normal.z)<1e-8);
});

test('vehicle footprints rotate their long axis and preserve narrow-side misses',()=>{
  const event:CitizenVehicleSweep={previous:{x:0,y:0,z:0},current:{x:0,y:0,z:0},yaw:0,width:.2,length:.8,height:.18,velocity:{x:0,y:0,z:0},vehicleId:2};
  assert.equal(sweepVehicleFootprint({x:.35,y:.09,z:0},event),null);
  assert.ok(sweepVehicleFootprint({x:.35,y:.09,z:0},{...event,yaw:Math.PI/2}));
  const angle=Math.PI/4;
  assert.ok(sweepVehicleFootprint({x:Math.sin(angle)*.35,y:.09,z:Math.cos(angle)*.35},{...event,yaw:angle}));
  assert.equal(sweepVehicleFootprint({x:Math.cos(angle)*.18,y:.09,z:-Math.sin(angle)*.18},{...event,yaw:angle}),null);
  const sweep={...event,previous:{x:-2,y:0,z:0},current:{x:2,y:0,z:0},yaw:Math.PI/2};
  assert.equal(sweepVehicleFootprint({x:0,y:.09,z:.126},sweep),null);
  assert.ok(sweepVehicleFootprint({x:0,y:.09,z:.124},sweep));
});

test('an elevated vehicle cannot strike pedestrians below its deck',()=>{
  const event:CitizenVehicleSweep={previous:{x:-2,y:3,z:0},current:{x:2,y:3,z:0},yaw:Math.PI/2,width:.2,length:.4,height:.18,velocity:{x:2,y:0,z:0},vehicleId:3};
  assert.equal(sweepVehicleFootprint({x:0,y:.09,z:0},event),null);
  assert.ok(sweepVehicleFootprint({x:0,y:3.09,z:0},event));
  assert.equal(sweepVehicleFootprint({x:0,y:3.5,z:0},event),null);
});

test('a stationary overlapping car leaves residents alive and upright',()=>{
  const state=roadCity(),incidents:Incident[]=[],system=createCitizens(state,incident=>incidents.push(incident));
  try {
    const person=system.getDebug().positions[0],event=passingCar(person,0);
    event.previous={...person};event.current={...person};
    for(let frame=0;frame<120;frame++){system.sweepVehicleImpact(event);system.animate(1/60,false);}
    assert.equal(system.getDebug().ragdolls,0);assert.equal(system.getDebug().recovering,0);
    assert.equal(system.getDebug().positions[0].state,'walking');assert.equal(incidents.length,0);assert.equal(state.stats.population,1);
  } finally {system.dispose();}
});

test('a moderate vehicle bump knocks a resident down, then allows recovery without a casualty',()=>{
  const state=roadCity(),incidents:Incident[]=[],system=createCitizens(state,incident=>incidents.push(incident));
  try {
    const person=system.getDebug().positions[0];
    system.sweepVehicleImpact(passingCar(person,.3));
    assert.equal(system.getDebug().ragdolls,1);assert.equal(incidents.length,0);
    let recovered=false;
    for(let frame=0;frame<720;frame++) {
      system.animate(1/60,false);
      if(system.getDebug().recovering)recovered=true;
      if(recovered&&system.getDebug().positions[0]?.state==='walking')break;
    }
    assert.ok(recovered,'A nonlethal bump should produce a visible get-up phase');
    assert.equal(system.getDebug().positions[0].state,'walking');assert.equal(system.getDebug().ragdolls,0);
    assert.equal(incidents.length,0);assert.equal(state.stats.population,1);
  } finally {system.dispose();}
});

test('a severe ram registers one witnessed casualty when the thrown resident contacts the ground',()=>{
  const state=roadCity(2),before={population:state.stats.population,loss:state.citizenEffects.populationLoss,happiness:state.stats.happiness},incidents:Incident[]=[];
  const system=createCitizens(state,incident=>{
    incidents.push(incident);assert.equal(applyCitizenIncident(state,incident).ok,true);system.update(state);
  });
  try {
    const person=system.getDebug().positions[0],event=passingCar(person,SEVERE_VEHICLE_IMPACT_SPEED+.35);
    system.sweepVehicleImpact(event);system.sweepVehicleImpact(event);
    assert.equal(system.getDebug().ragdolls,1);
    assert.equal(incidents.length,0,'The actor must first enter physics; the vehicle sweep alone must not create a floating stain');
    for(let frame=0;frame<480&&!incidents.length;frame++)system.animate(1/60,false);
    assert.equal(incidents.length,1);assert.equal(incidents[0].kind,'impact');assert.equal(incidents[0].witnessed,true);
    assert.ok(incidents[0].ny>.9,'The persisted impact should occur on the ground');
    assert.equal(state.stats.population,before.population-1);assert.equal(state.citizenEffects.populationLoss,before.loss+1);
    assert.equal(state.citizenEffects.happinessPenalty,2);assert.equal(state.stats.happiness,before.happiness-2);
    system.sweepVehicleImpact(event);advance(system,4);
    assert.equal(incidents.length,1);assert.equal(state.citizenEffects.incidents.length,1);
    assert.equal(system.group.getObjectByName('persistent-citizen-splatters')?.children.length,1);
  } finally {system.dispose();}
});

test('a close pass causes near-miss speech with a cooldown while avoiding physical injury',()=>{
  const state=roadCity(),incidents:Incident[]=[],system=createCitizens(state,incident=>incidents.push(incident));
  try {
    const person=system.getDebug().positions[0],event=passingCar(person,1.2,.18);
    system.sweepVehicleImpact(event);
    const first=system.getDebug().speech.find(entry=>entry.actorId===person.id&&entry.kind==='nearMiss');
    assert.ok(first,'A visibly close pass should provoke a near-miss reaction');
    advance(system,.5);system.sweepVehicleImpact(event);
    const repeated=system.getDebug().speech.find(entry=>entry.actorId===person.id&&entry.kind==='nearMiss');
    assert.equal(repeated?.expiresAt,first.expiresAt,'Repeated passes must not restart speech on every frame');
    advance(system,3.1);system.sweepVehicleImpact(event);
    assert.ok(!system.getDebug().speech.some(entry=>entry.kind==='nearMiss'),'Expired speech stays suppressed until its cooldown ends');
    advance(system,.5);system.sweepVehicleImpact(event);
    assert.ok(system.getDebug().speech.some(entry=>entry.actorId===person.id&&entry.kind==='nearMiss'&&entry.expiresAt>first.expiresAt));
    assert.equal(system.getDebug().ragdolls,0);assert.equal(incidents.length,0);assert.equal(state.stats.population,1);
  } finally {system.dispose();}
});

test('ordinary traffic sweeps produce awareness without killing or knocking down a resident',()=>{
  const state=roadCity(),incidents:Incident[]=[],system=createCitizens(state,incident=>incidents.push(incident));
  try {
    const person=system.getDebug().positions[0],event={...passingCar(person,2),trafficOnly:true};
    system.sweepVehicleImpact(event);
    assert.ok(system.getDebug().speech.some(entry=>entry.actorId===person.id&&['nearMiss','vehicle','observation'].includes(entry.kind)));
    advance(system,4);
    assert.equal(system.getDebug().ragdolls,0);assert.equal(system.getDebug().recovering,0);
    assert.equal(system.getDebug().count,1);assert.equal(state.stats.population,1);assert.equal(incidents.length,0);
  } finally {system.dispose();}
});
