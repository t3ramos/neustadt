import assert from 'node:assert/strict';
import test from 'node:test';
import { CitizenDialogue } from '../src/citizens.ts';
import { createCitizenSpeechSelector } from '../src/citizen-dialogue.ts';
import { createDrivingController, drivingSurfaceHeight, type DrivableCar, type DrivingStatus } from '../src/driving.ts';
import { createDetailedCar, refreshVehicleLabel, type VehicleKind } from '../src/vehicle-model.ts';
import { createCity } from '../src/simulation.ts';
import { createCityStorage, type CityStorageDatabase } from '../src/storage.ts';
import { setLocale } from '../src/i18n.ts';

function roadCity() {
  const state=createCity(917,true,40);
  for(const tile of state.tiles)Object.assign(tile,{kind:'road',elevation:0,level:0,anchor:-1});
  return state;
}

function drivable(state:ReturnType<typeof roadCity>,kind:VehicleKind='sedan'):DrivableCar {
  const model=createDetailedCar(0x496773,kind);
  model.position.set(.5,drivingSurfaceHeight(state,.5,-1),-1);
  return {model,from:{x:20,z:19},to:{x:20,z:20},previous:{x:20,z:18},progress:.5,speed:.4};
}

test('active NPC speech changes language without replacing its selection, lifetime, or cooldown',t=>{
  t.after(()=>setLocale('de'));setLocale('de');
  const selector=createCitizenSpeechSelector(59),dialogue=new CitizenDialogue();
  const pair=selector.pickPair('held',4);
  assert.equal(dialogue.speak(4,pair,'held',10),true);
  const original=dialogue.getActive(10.5)[0];
  assert.equal(original.text,pair.de);
  setLocale('en');
  assert.deepEqual(dialogue.getActive(10.5),[{...original,text:pair.en}]);
  assert.equal(dialogue.speak(4,pair,'held',11),false);
  setLocale('de');
  assert.deepEqual(dialogue.getActive(11),[original]);
  assert.deepEqual(dialogue.getActive(13.5),[]);
  assert.equal(dialogue.speak(4,pair,'held',13.99),false);
  assert.equal(dialogue.speak(4,pair,'held',14),true);
});

test('live vehicle labels switch both ways while preserving the fleet and active driving state',t=>{
  t.after(()=>setLocale('de'));setLocale('de');
  const state=roadCity(),fleet=(['sedan','taxi','van','truck'] as const).map(kind=>drivable(state,kind));
  fleet.forEach((car,i)=>car.model.position.x=i*2);
  const statuses:DrivingStatus[]=[],system=createDrivingController(state,()=>fleet,{onStatus:value=>statuses.push(value)});
  t.after(()=>system.dispose());
  system.enter(fleet[2].model.id);system.keyDown('KeyW');system.update(.1);
  const status=system.getStatus(),camera=system.camera.matrixWorld.clone();
  const cars=fleet.map(car=>({id:car.model.id,position:car.model.position.clone(),rotation:car.model.rotation.clone(),geometry:car.model.children[0]}));
  assert.equal(status.label,'Transporter');
  setLocale('en');system.refreshLocale();
  assert.equal(system.getStatus().label,'Van');
  assert.equal(statuses.at(-1)?.label,'Van');
  assert.equal(system.getStatus().speed,status.speed);
  assert.equal(system.selectedCar,fleet[2]);
  assert.deepEqual(system.camera.matrixWorld,camera);
  assert.deepEqual(fleet.map(car=>car.model.userData.vehicleLabel),['Sedan','Taxi','Van','Truck']);
  fleet.forEach((car,i)=>{
    assert.equal(car.model.id,cars[i].id);assert.deepEqual(car.model.position,cars[i].position);
    assert.ok(car.model.rotation.equals(cars[i].rotation));assert.equal(car.model.children[0],cars[i].geometry);
  });
  setLocale('de');system.refreshLocale();
  assert.deepEqual(fleet.map(car=>car.model.userData.vehicleLabel),['Limousine','Taxi','Transporter','Lastwagen']);
  assert.equal(system.getStatus().label,status.label);
});

test('an existing collision message re-translates immediately without rerunning physics',t=>{
  t.after(()=>setLocale('de'));setLocale('de');
  const state=roadCity(),car=drivable(state),system=createDrivingController(state,()=>[car]);
  t.after(()=>system.dispose());
  for(let x=0;x<state.size;x++)Object.assign(state.tiles[22*state.size+x],{kind:'residential',level:1,variation:0});
  system.enter(car.model.id);system.keyDown('KeyW');
  for(let step=0;step<720;step++)system.update(1/120);
  const before=system.getStatus(),position=car.model.position.clone();
  assert.equal(before.blocked,'Gebäude im Weg');
  setLocale('en');system.refreshLocale();
  assert.deepEqual(system.getStatus(),{...before,label:'Sedan',blocked:'Building in the way'});
  assert.deepEqual(car.model.position,position);
  setLocale('de');system.refreshLocale();assert.deepEqual(system.getStatus(),before);
});

test('untyped fallback cars receive translated driving labels and keep custom labels',t=>{
  t.after(()=>setLocale('de'));setLocale('en');
  const state=roadCity(),car=drivable(state);delete car.model.userData.vehicleKind;delete car.model.userData.vehicleLabel;
  const system=createDrivingController(state,()=>[car]);t.after(()=>system.dispose());
  system.enter(car.model.id);assert.equal(system.getStatus().label,'City car 01');
  setLocale('de');system.refreshLocale();assert.equal(system.getStatus().label,'Stadtauto 01');
  car.model.userData.vehicleLabel='Custom model';refreshVehicleLabel(car.model);
  assert.equal(system.getStatus().label,'Custom model');
});

test('storage recovery guidance is localized for load, save, and backup failures',async t=>{
  t.after(()=>setLocale('de'));setLocale('en');
  const failed=async()=>{throw new Error('test failure');};
  const database:CityStorageDatabase={read:failed,write:failed,writeIfAbsent:failed};
  const storage=createCityStorage({database,localStorage:()=>null});
  assert.match((await storage.loadSavedCity()).error??'',/^Browser storage could not be fully read\./);
  await assert.rejects(storage.saveCityRaw('city'),/^Error: Your city could not be saved\./);
  await assert.rejects(storage.backupLegacy('legacy'),/^Error: The additional backup could not be created\./);
  setLocale('de');
  assert.match((await storage.loadSavedCity()).error??'',/^Der Browserspeicher/);
  await assert.rejects(storage.saveCityRaw('city'),/Exportiere deine Stadt/);
  await assert.rejects(storage.backupLegacy('legacy'),/^Error: Die zusätzliche Sicherung/);
});
