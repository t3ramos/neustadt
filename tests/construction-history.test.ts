import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canUndoConstruction,captureConstructionState,clearConstructionHistory,
  recordConstruction,undoConstruction,type ConstructionHistory,
} from '../src/construction-history.ts';
import { applyCitizenIncident,build,createCity,getFootprint,recalculate,takeLoan,tick,triggerDisaster } from '../src/simulation.ts';
import { CHALLENGES,claimQuest,getQuestProgress,startChallenge,updateProgression } from '../src/progression.ts';
import type { CityState,Point,Tool } from '../src/types.ts';

function flatCity():CityState {
  const city=createCity(55,true,40);
  for (const tile of city.tiles) Object.assign(tile,{kind:'empty',level:0,age:0,fire:0,elevation:1,anchor:-1,rotation:0,hasPipe:false,hasPowerLine:false});
  recalculate(city);
  return city;
}
const tile=(city:CityState,x=10,z=10)=>city.tiles[z*city.size+x];
const line=(count:number,z=10):Point[]=>Array.from({length:count},(_,i)=>({x:10+i,z}));
function construct(city:CityState,history:ConstructionHistory,tool:Tool='road',points:Point[]=line(1)) {
  const before=captureConstructionState(city),result=build(city,points,tool);
  assert.ok(result.ok,result.message);
  assert.ok(recordConstruction(history,before,city,tool,result));
  return result;
}

test('undo remains available through months and refunds only the original construction cost',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  const result=construct(city,history,'road',line(3));
  tick(city);tick(city);tick(city);
  const month=city.month,money=city.money,points=structuredClone(city.history),events=structuredClone(city.events);
  assert.ok(canUndoConstruction(history));
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(city.month,month);
  assert.equal(city.money,money+result.cost);
  assert.deepEqual(city.history,points);
  assert.deepEqual(city.events,events);
  assert.ok(line(3).every(p=>tile(city,p.x,p.z).kind==='empty'));
  assert.equal(city.stats.expenses,0);
  assert.equal(canUndoConstruction(history),false);
});

test('unrelated growth, loans, settings, and resident consequences survive construction undo',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  Object.assign(tile(city,25,25),{kind:'residential',level:1,age:2});
  recalculate(city);
  const result=construct(city,history);
  city.name='A continuing city';city.speed=3;city.tax=12;city.funding.fire=140;
  Object.assign(city.settings,{weather:'rain',timeOfDay:21,buildingLights:false,dayNightCycle:false});
  assert.ok(takeLoan(city).ok);
  Object.assign(tile(city,25,25),{level:3,age:19});
  recalculate(city);
  assert.ok(applyCitizenIncident(city,{x:25,y:1,z:25,nx:0,ny:1,nz:0,witnessed:true,kind:'impact'}).ok);
  const other=structuredClone(tile(city,25,25)),effects=structuredClone(city.citizenEffects),money=city.money,settings=structuredClone(city.settings);
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(city.name,'A continuing city');assert.equal(city.speed,3);assert.equal(city.tax,12);assert.equal(city.funding.fire,140);
  assert.equal(city.loan,10000);assert.equal(city.progression.counters.loansTaken,1);
  assert.equal(city.money,money+result.cost);
  assert.deepEqual(city.settings,settings);
  assert.deepEqual(city.citizenEffects,effects);
  assert.deepEqual(tile(city,25,25),other);
});

test('zoning undo removes later growth on its own plot while preserving unrelated development',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  Object.assign(tile(city),{kind:'tree',level:0,age:4,hasPipe:true});
  const original=structuredClone(tile(city));
  construct(city,history,'residential');
  Object.assign(tile(city),{level:3,age:15});
  Object.assign(tile(city,25,25),{kind:'commercial',level:2,age:7});
  city.month=20;
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(tile(city).kind,original.kind);
  assert.equal(tile(city).age,original.age);
  assert.equal(tile(city).level,original.level);
  assert.equal(tile(city).hasPipe,true);
  assert.equal(tile(city,25,25).level,2);
  assert.equal(city.month,20);
});

test('undoing a pipe beneath a zone preserves the grown building and its age',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  Object.assign(tile(city),{kind:'residential',level:1,age:1,hasPowerLine:true});
  construct(city,history,'pipe');
  Object.assign(tile(city),{level:3,age:8});
  city.month=14;
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(tile(city).kind,'residential');assert.equal(tile(city).level,3);assert.equal(tile(city).age,8);
  assert.equal(tile(city).hasPipe,false);assert.equal(tile(city).hasPowerLine,true);
  assert.equal(city.month,14);
});

test('successive utility and zone edits undo independently after growth',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  construct(city,history,'residential');
  construct(city,history,'pipe');
  construct(city,history,'powerline');
  Object.assign(tile(city),{level:2,age:9});
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(tile(city).hasPipe,true);assert.equal(tile(city).hasPowerLine,false);assert.equal(tile(city).level,2);
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(tile(city).hasPipe,false);assert.equal(tile(city).level,2);
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(tile(city).kind,'empty');assert.equal(tile(city).level,0);
  assert.equal(city.progression.xp,0);
  assert.equal(city.progression.counters.totalBuilt,0);
});

test('facility placement and demolition undo whole footprints with original utilities',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  tile(city,11,10).kind='tree';tile(city,11,10).hasPipe=true;
  const facility=construct(city,history,'fire');
  const footprint=getFootprint(city,tile(city));
  assert.equal(footprint.length,6);
  const members=footprint.map(p=>structuredClone(tile(city,p.x,p.z)));
  const demolition=construct(city,history,'bulldoze',[{x:11,z:11}]);
  assert.ok(footprint.every(p=>tile(city,p.x,p.z).kind==='empty'));
  const money=city.money;
  city.month=7;
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(city.money,money+demolition.cost);
  footprint.forEach((p,i)=>assert.deepEqual(tile(city,p.x,p.z),members[i]));
  assert.equal(getFootprint(city,tile(city,11,11)).length,6);
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(city.money,money+demolition.cost+facility.cost);
  assert.equal(tile(city,11,10).kind,'tree');assert.equal(tile(city,11,10).hasPipe,true);
  assert.equal(tile(city).kind,'empty');assert.equal(city.month,7);
});

test('terrain undo restores elevation and water without touching current unrelated state',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  tile(city).elevation=0;tile(city).kind='tree';tile(city).hasPipe=true;
  construct(city,history,'lower');
  assert.equal(tile(city).kind,'water');
  city.money-=200;city.month=4;
  const money=city.money;
  const result=undoConstruction(city,history);
  assert.ok(result.ok);assert.equal(tile(city).elevation,0);assert.equal(tile(city).kind,'tree');assert.equal(tile(city).hasPipe,true);
  assert.equal(city.month,4);assert.equal(city.money,money-result.cost);
  assert.equal(city.progression.counters.terrainTiles,0);
});

for (const change of ['fire','rubble','utility','elevation','footprint'] as const) test(`conflicting ${change} change blocks the whole edit without refund or partial mutation`,()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  construct(city,history,'fire');
  const target=tile(city,11,11);
  if (change==='fire') target.fire=4;
  if (change==='rubble') target.kind='rubble';
  if (change==='utility') target.hasPipe=true;
  if (change==='elevation') target.elevation=2;
  if (change==='footprint') target.anchor=-1;
  const before=JSON.stringify(city);
  assert.equal(undoConstruction(city,history).ok,false);
  assert.equal(JSON.stringify(city),before);
  assert.equal(history.length,0);
});

test('construction XP and counters reverse without erasing newer monthly progress',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  city.progression.xp=300;city.progression.counters.built_road=2;city.progression.counters.totalBuilt=7;
  construct(city,history,'road',line(3));
  city.progression.xp+=200;
  Object.assign(city.progression.counters,{profitableMonths:4,lastProgressMonth:8,loansTaken:2});
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(city.progression.xp,500);assert.equal(city.progression.counters.built_road,2);assert.equal(city.progression.counters.totalBuilt,7);
  assert.equal(city.progression.counters.profitableMonths,4);assert.equal(city.progression.counters.lastProgressMonth,8);assert.equal(city.progression.counters.loansTaken,2);
});

test('unclaimed quest completion dependent on the undone construction is withdrawn',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  construct(city,history,'road',line(10));
  assert.ok(getQuestProgress(city,'first-roads').complete);
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(getQuestProgress(city,'first-roads').complete,false);
  assert.equal(claimQuest(city,'first-roads').ok,false);
  construct(city,history,'road',line(10));
  assert.equal(city.progression.xp,10);
  assert.ok(claimQuest(city,'first-roads').ok);
  assert.equal(city.progression.xp,110);
});

test('quest claims are an explicit barrier even if a caller forgets to clear history',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  construct(city,history,'road',line(10));
  assert.ok(claimQuest(city,'first-roads').ok);
  const before=JSON.stringify(city);
  assert.equal(undoConstruction(city,history).ok,false);
  assert.equal(JSON.stringify(city),before);
  assert.equal(history.length,0);
});

test('a challenge completed during construction keeps its reward and cannot pay again after undo',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  const challenge=CHALLENGES.find(item=>item.id==='treasury-builder')!;
  assert.ok(startChallenge(city,challenge.id).ok);
  city.month=1;
  city.money+=challenge.target+100;
  const money=city.money,xp=city.progression.xp;
  const construction=construct(city,history);
  assert.equal(city.progression.activeChallenge?.status,'completed');
  assert.equal(city.money,money-construction.cost+challenge.rewardMoney);
  assert.equal(city.progression.xp,xp+1+challenge.rewardXp);
  assert.ok(undoConstruction(city,history).ok);
  assert.equal(city.money,money+challenge.rewardMoney);
  assert.equal(city.progression.xp,xp+challenge.rewardXp);
  assert.ok(city.progression.completedChallenges.includes(challenge.id));
  assert.equal(city.progression.activeChallenge?.status,'completed');
  construct(city,history);
  assert.ok(undoConstruction(city,history).ok);
  updateProgression(city);
  assert.equal(city.money,money+challenge.rewardMoney);
  assert.equal(city.progression.xp,xp+challenge.rewardXp);
  assert.equal(startChallenge(city,challenge.id).ok,false);
});

test('history keeps ten edits and failed builds do not consume an undo entry',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  for (const point of line(11)) construct(city,history,'road',[point]);
  assert.equal(history.length,10);
  const before=captureConstructionState(city),failure=build(city,line(1),'road');
  assert.equal(failure.ok,false);
  assert.equal(recordConstruction(history,before,city,'road',failure),false);
  assert.equal(history.length,10);
  while (history.length) assert.ok(undoConstruction(city,history).ok);
  assert.equal(tile(city).kind,'road');
  assert.ok(line(10).slice(1).every(p=>tile(city,p.x,p.z).kind==='empty'));
  assert.equal(undoConstruction(city,history).ok,false);
});

test('new city identity, disasters, and clearing history prevent stale undo',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  construct(city,history,'fire');
  const other=flatCity(),before=JSON.stringify(other);
  assert.equal(undoConstruction(other,history).ok,false);
  assert.equal(JSON.stringify(other),before);
  construct(city,history,'road',[{x:25,z:25}]);
  city.settings.disastersEnabled=true;
  assert.ok(triggerDisaster(city,'storm').ok);
  const afterDisaster=JSON.stringify(city);
  assert.equal(undoConstruction(city,history).ok,false);
  assert.equal(JSON.stringify(city),afterDisaster);
  construct(city,history,'road',[{x:30,z:30}]);
  clearConstructionHistory(history);
  assert.equal(canUndoConstruction(history),false);
});

test('demolishing a burning building does not record a fire-resurrecting undo',()=>{
  const city=flatCity(),history:ConstructionHistory=[];
  construct(city,history,'residential');
  tile(city).fire=5;tile(city).level=2;
  const before=captureConstructionState(city),result=build(city,line(1),'bulldoze');
  assert.ok(result.ok);
  assert.equal(recordConstruction(history,before,city,'bulldoze',result),false);
  assert.equal(history.length,0);
  assert.equal(tile(city).fire,0);
});
