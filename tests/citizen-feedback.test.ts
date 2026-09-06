import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CITIZEN_SCALE, CitizenDialogue, chooseCitizenComment, createCitizens, type CitizenSystem } from '../src/citizens.ts';
import { applyCitizenIncident, createCity, recalculate } from '../src/simulation.ts';
import type { CitizenIncident, CityState } from '../src/types.ts';

type Point={x:number;y:number;z:number};
type Incident=Omit<CitizenIncident,'id'|'month'>;

function feedbackCity(population=1):CityState {
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
  return state;
}

function gesture(system:CitizenSystem,position:Point) {
  let time=0,cursor={x:position.x,y:position.y+.32*CITIZEN_SCALE,z:position.z};
  const ray=(point:Point)=>new THREE.Ray(new THREE.Vector3(point.x,point.y,point.z-1),new THREE.Vector3(0,0,1));
  assert.equal(system.pointerDown(ray(cursor),new THREE.Vector3(0,-.7,.7),time),true);
  return {
    moveTo(target:Point,seconds:number) {
      const start={...cursor},frames=Math.ceil(seconds*60),dt=seconds/frames;
      for(let frame=1;frame<=frames;frame++) {
        const t=frame/frames;cursor={x:start.x+(target.x-start.x)*t,y:start.y+(target.y-start.y)*t,z:target.z};
        time+=dt*1000;system.pointerMove(ray(cursor),time);system.animate(dt,false);
      }
    },
    step(seconds=1/60,walking=false) {time+=seconds*1000;system.animate(seconds,walking);},
    wait(seconds:number,walking=false) {
      const frames=Math.ceil(seconds*60),dt=seconds/frames;
      for(let i=0;i<frames;i++){time+=dt*1000;system.animate(dt,walking);}
    },
    release() {time++;assert.equal(system.pointerUp(time),true);},
  };
}

function torsoPosition(system:CitizenSystem):THREE.Vector3 {
  const mesh=system.group.getObjectByName('citizen-torso') as THREE.InstancedMesh;
  const matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

test('citizen dialogue expires after 3.5 seconds and independently limits idle and reactive repetition',()=>{
  const dialogue=new CitizenDialogue();
  assert.equal(dialogue.speak(1,'Ein schöner Spaziergang.','idle',0),true);
  assert.equal(dialogue.speak(1,'Schon wieder ich.','idle',1),false);
  assert.deepEqual(dialogue.getActive(3.49),[{actorId:1,text:'Ein schöner Spaziergang.',kind:'idle',expiresAt:3.5}]);
  assert.deepEqual(dialogue.getActive(3.5),[]);
  assert.equal(dialogue.speak(1,'Noch zu früh.','idle',13.99),false);
  assert.equal(dialogue.speak(1,'Weiter geht es.','idle',14),true);
  assert.equal(dialogue.speak(2,'He!','held',20),true);
  assert.equal(dialogue.speak(2,'He!','held',23.99),false);
  assert.equal(dialogue.speak(2,'He!','held',24),true);
});

test('held and recovery reactions replace idle speech without duplicate bubbles or cross-kind suppression',()=>{
  const dialogue=new CitizenDialogue();
  assert.equal(dialogue.speak(7,'Ich gehe zum Park.','idle',0),true);
  assert.equal(dialogue.speak(7,'Vorsichtig!','held',.1),true);
  assert.deepEqual(dialogue.getActive(.1).map(entry=>[entry.actorId,entry.kind]),[[7,'held']]);
  assert.equal(dialogue.speak(7,'Alles in Ordnung.','recovery',.2),true);
  assert.deepEqual(dialogue.getActive(.2).map(entry=>[entry.actorId,entry.kind]),[[7,'recovery']]);
  assert.equal(dialogue.speak(7,'Vorsichtig!','held',1),false);
  assert.equal(dialogue.getActive(1).length,1);
});

test('dialogue keeps at most three visible speakers and protects reactions from ambient chatter',()=>{
  const dialogue=new CitizenDialogue();
  assert.equal(dialogue.speak(1,'Alt.','idle',0),true);
  assert.equal(dialogue.speak(2,'Neu.','idle',.1),true);
  assert.equal(dialogue.speak(3,'Hilfe!','witness',.2),true);
  assert.equal(dialogue.speak(4,'Vorsichtig!','held',.3),true);
  assert.deepEqual(dialogue.getActive(.3).map(entry=>entry.actorId).sort((a,b)=>a-b),[2,3,4]);
  assert.equal(dialogue.speak(5,'Wieder auf den Beinen.','recovery',.4),true);
  assert.equal(dialogue.getActive(.4).length,3);
  assert.equal(dialogue.speak(6,'Schönes Wetter.','idle',.5),false);
  const active=dialogue.getActive(.5);
  assert.equal(active.length,3);assert.equal(new Set(active.map(entry=>entry.actorId)).size,3);
  assert.ok(active.every(entry=>entry.kind!=='idle'));
});

test('ambient citizen comments are deterministic and respond to night, pollution, parks and happiness',()=>{
  const day=feedbackCity();day.settings.timeOfDay=14;day.settings.weather='clear';day.stats.happiness=50;day.stats.pollution=0;
  const position={x:10.5-day.size/2,y:1,z:10.5-day.size/2};
  const night=structuredClone(day);night.settings.timeOfDay=2;
  const polluted=structuredClone(day);polluted.stats.pollution=95;
  polluted.tiles[10*polluted.size+10].pollution=95;
  const park=structuredClone(day);park.tiles[10*park.size+9].kind='park';park.stats.parks=1;
  const happy=structuredClone(day);happy.stats.happiness=95;
  for(const [label,state] of [['night',night],['pollution',polluted],['park',park],['happiness',happy]] as const) {
    let contextual=false;
    for(let variant=0;variant<8;variant++) {
      const comment=chooseCitizenComment(state,position,variant);
      assert.ok(comment.trim().length>0,`${label} comment must be readable`);
      assert.equal(chooseCitizenComment(state,position,variant),comment);
      if(comment!==chooseCitizenComment(day,position,variant))contextual=true;
    }
    assert.ok(contextual,`${label} should influence the resident's comment`);
  }
});

test('a held resident speaks and a surviving nearby witness reacts to a physical casualty',()=>{
  const state=feedbackCity(2),incidents:Incident[]=[];
  const system=createCitizens(state,incident=>{
    incidents.push(incident);assert.equal(applyCitizenIncident(state,incident).ok,true);system.update(state);
  });
  try {
    system.setEnabled(true);assert.equal(system.getDebug().count,2);
    const person=system.getDebug().positions[0],hand=gesture(system,person);
    assert.ok(system.getDebug().speech.some(entry=>entry.actorId===person.id&&entry.kind==='held'));
    hand.moveTo({x:person.x,y:person.y+2,z:person.z},.7);hand.wait(.3);
    hand.moveTo({x:person.x,y:person.y+1.4,z:person.z},.06);hand.release();
    for(let frame=0;frame<300&&!incidents.length;frame++)hand.step();
    assert.equal(incidents.length,1);assert.equal(incidents[0].witnessed,true);
    assert.ok(system.getDebug().speech.some(entry=>entry.actorId!==person.id&&entry.kind==='witness'));
    assert.equal(state.stats.population,1);assert.equal(state.citizenEffects.happinessPenalty,2);
  } finally {system.dispose();}
});

test('a short nonlethal drop blends through recovery before the resident walks and speaks again',()=>{
  const state=feedbackCity(),incidents:Incident[]=[],system=createCitizens(state,incident=>incidents.push(incident));
  try {
    system.setEnabled(true);
    const person=system.getDebug().positions[0],hand=gesture(system,person);
    hand.moveTo({x:person.x,y:person.y+.32*CITIZEN_SCALE+.25,z:person.z},.6);
    hand.wait(.3);hand.release();
    assert.equal(system.getDebug().positions[0].state,'ragdoll');
    let before=torsoPosition(system),started=false;
    for(let frame=0;frame<480;frame++) {
      before=torsoPosition(system);hand.step();
      if(system.getDebug().recovering){started=true;break;}
    }
    assert.ok(started,'A harmless drop should enter a get-up animation after physical settling');
    assert.equal(incidents.length,0);assert.equal(system.getDebug().positions[0].state,'recovering');
    assert.ok(torsoPosition(system).distanceTo(before)<.05,'The first recovery frame must retain the fallen pose instead of popping upright');
    const firstPose=torsoPosition(system);
    hand.wait(1);
    assert.equal(system.getDebug().recovering,1,'Getting up should take time');
    assert.ok(torsoPosition(system).distanceTo(firstPose)>.005,'The recovery animation must change the rendered pose');
    hand.wait(1);
    assert.equal(system.getDebug().recovering,0);assert.equal(system.getDebug().positions[0].state,'walking');
    assert.ok(system.getDebug().speech.some(entry=>entry.actorId===person.id&&entry.kind==='recovery'));
    const standing=system.getDebug().positions[0];hand.wait(5,true);
    const walking=system.getDebug().positions[0];
    assert.ok(Math.hypot(walking.x-standing.x,walking.z-standing.z)>.1);
    assert.equal(incidents.length,0);assert.equal(state.stats.population,1);
  } finally {system.dispose();}
});
