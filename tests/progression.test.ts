import assert from 'node:assert/strict';
import test from 'node:test';
import type { CityState, Tile } from '../src/types.ts';
import {
  CHALLENGES, QUESTS, RANKS, claimQuest, createProgression, getCampaignProgress,
  getChallengeProgress, getQuestProgress, getRank, isToolUnlocked, recordBuild,
  startChallenge, updateProgression, normalizeProgression,
} from '../src/progression.ts';

function fixture(population=0):CityState {
  const state:CityState={
    version:2,citizenEffects:{populationLoss:0,happinessPenalty:0,incidents:[]},name:'Teststadt',size:128,seed:123,tiles:[],money:100000,month:0,speed:1,tax:9,
    funding:{police:100,fire:100,health:100,education:100},loan:0,events:[],history:[],revision:0,milestone:0,
    stats:{population,jobs:population*.6,happiness:80,income:12000,expenses:8000,balance:4000,powerSupply:12000,powerDemand:1000,waterSupply:12000,waterDemand:1000,residentialDemand:30,commercialDemand:30,industrialDemand:30,pollution:15,traffic:10,education:70,health:70,safety:70,parks:0},
    progression:createProgression(),settings:{disastersEnabled:false,weather:'clear',dayNightCycle:true,timeOfDay:14,buildingLights:true},
  };
  state.progression=createProgression(state);
  return state;
}

function tile(kind:Tile['kind'],extra:Partial<Tile>={}):Tile {
  return {x:0,z:0,kind,level:1,variation:0,powered:true,watered:true,connected:true,pollution:0,landValue:60,traffic:0,fire:0,age:0,elevation:1,hasPipe:true,hasPowerLine:true,anchor:-1,rotation:0,...extra};
}

function nextMonth(state:CityState):void {
  state.month++;
  updateProgression(state,{monthly:true});
}

test('new cities expose exactly three development stages with full initial public services',()=>{
  const empty=fixture();
  assert.equal(RANKS.length,3);
  assert.equal(getRank(empty).name,'Kleinstadt');
  assert.equal(getRank(empty).next?.population,5000);
  for(const tool of ['road','power','waterpump','pipe','powerline','police','fire','school','hospital','raise','lower','level'] as const) assert.ok(isToolUnlocked(empty,tool),tool);
  for(const tool of ['wind','solar','rail','stadium','university','airport'] as const) assert.equal(isToolUnlocked(empty,tool),false,tool);
  const starter=fixture(2000);
  assert.equal(getRank(starter).name,'Kleinstadt');
  assert.ok(isToolUnlocked(starter,'school'));
  assert.ok(isToolUnlocked(starter,'hospital'));
  assert.equal(isToolUnlocked(starter,'wind'),false);
  assert.equal(isToolUnlocked(starter,'rail'),false);
  assert.deepEqual(starter.progression.completedQuests,[]);
});

test('earned ranks and building unlocks persist after population loss and announce only once',()=>{
  const state=fixture();
  state.stats.population=15000;
  updateProgression(state);
  assert.equal(getRank(state).name,'Metropole');
  assert.ok(isToolUnlocked(state,'airport'));
  const eventCount=state.events.length;
  state.stats.population=10;
  updateProgression(state);
  assert.equal(getRank(state).name,'Metropole');
  assert.ok(isToolUnlocked(state,'airport'));
  assert.equal(state.events.length,eventCount);
});

test('legacy building types remain unlocked without falsely completing action-based quests',()=>{
  const state=fixture(50);
  state.tiles=[tile('airport'),tile('university'),...Array.from({length:20},()=>tile('road'))];
  state.progression=createProgression(state);
  updateProgression(state);
  assert.equal(getRank(state).id,0);
  assert.ok(isToolUnlocked(state,'airport'));
  assert.ok(isToolUnlocked(state,'university'));
  assert.equal(getQuestProgress(state,'first-roads').current,0);
  assert.equal(getQuestProgress(state,'knowledge-city').complete,false);
  assert.deepEqual(state.progression.completedQuests,[]);
});

test('construction quests need actual successful builds and rewards require an explicit one-time claim',()=>{
  const state=fixture();
  const initialMoney=state.money;
  recordBuild(state,'road',9);
  recordBuild(state,'road',0);
  recordBuild(state,'road',NaN);
  recordBuild(state,'road',-1);
  updateProgression(state);
  assert.equal(getQuestProgress(state,'first-roads').complete,false);
  assert.equal(claimQuest(state,'first-roads').ok,false);
  recordBuild(state,'road',1);
  updateProgression(state);
  const earnedXp=state.progression.xp;
  assert.equal(getQuestProgress(state,'first-roads').complete,true);
  assert.equal(state.money,initialMoney,'Completion alone must not add money');
  const reward=QUESTS.find(quest=>quest.id==='first-roads')!;
  assert.equal(claimQuest(state,'first-roads').ok,true);
  assert.equal(state.money,initialMoney+reward.rewardMoney);
  assert.equal(state.progression.xp,earnedXp+reward.rewardXp);
  assert.equal(claimQuest(state,'first-roads').ok,false);
  assert.equal(state.money,initialMoney+reward.rewardMoney);
  assert.equal(claimQuest(state,'unknown').ok,false);
});

test('multi-condition quests cannot be completed by overbuilding only one component',()=>{
  const state=fixture(2000);
  recordBuild(state,'pipe',100);
  assert.equal(getQuestProgress(state,'utility-network').current,8);
  assert.equal(getQuestProgress(state,'utility-network').complete,false);
  recordBuild(state,'powerline',8);
  assert.equal(getQuestProgress(state,'utility-network').complete,true);
  recordBuild(state,'park',100);
  assert.equal(getQuestProgress(state,'urban-nature').complete,false);
  recordBuild(state,'tree',25);
  assert.equal(getQuestProgress(state,'urban-nature').complete,true);
  recordBuild(state,'raise',4);
  recordBuild(state,'lower',4);
  recordBuild(state,'level',4);
  assert.equal(getQuestProgress(state,'shape-land').complete,true);
});

test('monthly utility streaks require real household service, user pipes and lines, and consecutive months',()=>{
  const state=fixture(2000);
  state.tiles=Array.from({length:20},(_,x)=>tile('residential',{x}));
  nextMonth(state);
  assert.equal(getQuestProgress(state,'reliable-services').current,0,'Existing roads and utilities do not satisfy the construction condition');
  recordBuild(state,'pipe',8);
  recordBuild(state,'powerline',8);
  nextMonth(state);
  updateProgression(state,{monthly:true});
  updateProgression(state,{monthly:true});
  assert.equal(getQuestProgress(state,'reliable-services').current,1,'Repeated updates in one month must not advance time');
  state.tiles[0].watered=false;
  state.tiles[1].watered=false;
  nextMonth(state);
  assert.equal(getQuestProgress(state,'reliable-services').current,0,'90% coverage resets the streak');
  state.tiles[0].watered=true;
  nextMonth(state);
  nextMonth(state);
  nextMonth(state);
  assert.equal(getQuestProgress(state,'reliable-services').complete,true,'95% coverage is sufficient');
});

test('job and public service quests require construction and measurable operational outcomes',()=>{
  const state=fixture(15000);
  recordBuild(state,'industrial',12);
  state.stats.jobs=100;
  assert.equal(getQuestProgress(state,'local-jobs').complete,false);
  state.stats.jobs=7500;
  assert.equal(getQuestProgress(state,'local-jobs').complete,true);
  state.tiles=[tile('university')];
  assert.equal(getQuestProgress(state,'knowledge-city').complete,false,'Starter or imported universities are not new construction');
  recordBuild(state,'university',1);
  state.tiles[0].powered=false;
  assert.equal(getQuestProgress(state,'knowledge-city').complete,false);
  state.tiles[0].powered=true;
  assert.equal(getQuestProgress(state,'knowledge-city').complete,true);
});

test('green energy quest requires sufficient real service and no active fossil generator',()=>{
  const state=fixture(5000);
  state.tiles=[tile('wind'),tile('power',{x:1}),tile('residential',{x:2})];
  recordBuild(state,'wind',1);
  assert.equal(getQuestProgress(state,'clean-energy').complete,false);
  state.tiles[1].connected=false;
  assert.equal(getQuestProgress(state,'clean-energy').complete,true);
  state.stats.powerSupply=0;
  assert.equal(getQuestProgress(state,'clean-energy').complete,false);
});

test('completed quests remain achieved after temporary conditions deteriorate',()=>{
  const state=fixture(1500);
  state.tiles=[tile('hospital')];
  recordBuild(state,'hospital',1);
  updateProgression(state);
  assert.equal(getQuestProgress(state,'healthy-city').complete,true);
  state.stats.health=10;
  state.tiles=[];
  assert.equal(getQuestProgress(state,'healthy-city').complete,true);
  assert.ok(claimQuest(state,'healthy-city').ok);
});

test('growth challenge measures additional residents and pays only once including after save restoration',()=>{
  const state=fixture(2000);
  assert.ok(startChallenge(state,'growth-spurt').ok);
  assert.equal(startChallenge(state,'green-capital').ok,false,'Only one active challenge is allowed');
  assert.equal(getChallengeProgress(state)?.current,0);
  state.stats.population=7000;
  updateProgression(state);
  assert.equal(getChallengeProgress(state)?.status,'active','A challenge must span at least one simulation month');
  const money=state.money;
  nextMonth(state);
  const reward=CHALLENGES.find(challenge=>challenge.id==='growth-spurt')!.rewardMoney;
  assert.equal(getChallengeProgress(state)?.status,'completed');
  assert.equal(state.money,money+reward);
  const loaded=JSON.parse(JSON.stringify(state)) as CityState;
  updateProgression(loaded,{monthly:true});
  nextMonth(loaded);
  assert.equal(loaded.money,state.money);
  assert.equal(startChallenge(loaded,'growth-spurt').ok,false);
  assert.equal(loaded.progression.completedChallenges.filter(id=>id==='growth-spurt').length,1);
});

test('challenge expiry is strict, exact-deadline success counts, and failed challenges can be retried',()=>{
  const failed=fixture();
  assert.ok(startChallenge(failed,'growth-spurt').ok);
  failed.month=60;
  updateProgression(failed,{monthly:true});
  assert.equal(getChallengeProgress(failed)?.status,'failed');
  assert.equal(getChallengeProgress(failed)?.remainingMonths,0);
  assert.ok(startChallenge(failed,'growth-spurt').ok);
  assert.equal(getChallengeProgress(failed)?.remainingMonths,60);
  const success=fixture();
  startChallenge(success,'growth-spurt');
  success.month=60;
  success.stats.population=5000;
  updateProgression(success,{monthly:true});
  assert.equal(getChallengeProgress(success)?.status,'completed');
  const tooLate=fixture();
  startChallenge(tooLate,'growth-spurt');
  tooLate.month=61;
  tooLate.stats.population=5000;
  updateProgression(tooLate,{monthly:true});
  assert.equal(getChallengeProgress(tooLate)?.status,'failed');
});

test('green challenge requires both population and pollution rather than population alone',()=>{
  const state=fixture(10000);
  startChallenge(state,'green-capital');
  nextMonth(state);
  assert.equal(getChallengeProgress(state)?.status,'active');
  state.stats.pollution=10;
  nextMonth(state);
  assert.equal(getChallengeProgress(state)?.status,'active','The target is strictly below 10');
  state.stats.pollution=9.9;
  nextMonth(state);
  assert.equal(getChallengeProgress(state)?.status,'completed');
});

test('treasury challenge catches new loans even when repaid and supports legitimate cash success',()=>{
  const state=fixture();
  startChallenge(state,'treasury-builder');
  state.progression.counters.loansTaken++;
  state.loan=0;
  state.money+=160000;
  nextMonth(state);
  assert.equal(getChallengeProgress(state)?.status,'failed');
  assert.equal(state.progression.completedChallenges.includes('treasury-builder'),false);
  assert.ok(startChallenge(state,'treasury-builder').ok);
  state.money+=150000;
  const before=state.money;
  nextMonth(state);
  assert.equal(getChallengeProgress(state)?.status,'completed');
  assert.equal(state.money,before+CHALLENGES.find(challenge=>challenge.id==='treasury-builder')!.rewardMoney);
});

test('campaign victory needs six consecutive months with all city targets simultaneously, then freeplay persists',()=>{
  const state=fixture(25000);
  for(let i=0;i<5;i++) nextMonth(state);
  assert.equal(state.progression.victory,false);
  assert.equal(getCampaignProgress(state).requirements.at(-1)?.current,5);
  state.stats.health=69;
  nextMonth(state);
  assert.equal(getCampaignProgress(state).requirements.at(-1)?.current,0);
  state.stats.health=70;
  for(let i=0;i<6;i++) nextMonth(state);
  assert.equal(state.progression.victory,true);
  assert.equal(getCampaignProgress(state).complete,true);
  assert.equal(getRank(state).next,null);
  assert.ok(getQuestProgress(state,'city-of-tomorrow').complete);
  const victoryEvents=state.events.filter(event=>event.title.startsWith('Stadtziel erreicht'));
  assert.equal(victoryEvents.length,1);
  state.stats.population=100;
  nextMonth(state);
  assert.equal(state.progression.victory,true,'Victory persists during free play');
  assert.equal(state.events.filter(event=>event.title.startsWith('Stadtziel erreicht')).length,1);
  assert.ok(claimQuest(state,'city-of-tomorrow').ok);
  assert.equal(claimQuest(state,'city-of-tomorrow').ok,false);
});

test('skipped simulation months never fabricate a six-month sustainability streak',()=>{
  const state=fixture(25000);
  nextMonth(state);
  state.month=20;
  updateProgression(state,{monthly:true});
  assert.equal(state.progression.counters.sustainableMonths,1);
  for(let i=0;i<100;i++) updateProgression(state,{monthly:true});
  assert.equal(state.progression.counters.sustainableMonths,1);
  assert.equal(state.progression.victory,false);
});

test('treasury challenge preserves a negative starting treasury when measuring real cash improvement',()=>{
  const state=fixture();
  state.money=-50000;
  startChallenge(state,'treasury-builder');
  state.money=100000;
  nextMonth(state);
  assert.equal(getChallengeProgress(state)?.status,'completed');
});

test('all three development stages unlock the exact matching facilities at 5000 and 15000 residents',()=>{
  const state=fixture(4999);
  assert.equal(getRank(state).id,0);
  assert.equal(isToolUnlocked(state,'rail'),false);
  state.stats.population=5000;
  updateProgression(state);
  assert.equal(getRank(state).id,1);
  for(const tool of ['rail','wind','solar','stadium','seaport','recycling'] as const) assert.ok(isToolUnlocked(state,tool));
  assert.equal(isToolUnlocked(state,'airport'),false);
  assert.equal(isToolUnlocked(state,'university'),false);
  state.stats.population=14999;
  updateProgression(state);
  assert.equal(getRank(state).id,1);
  state.stats.population=15000;
  updateProgression(state);
  assert.equal(getRank(state).id,2);
  assert.equal(getRank(state).next,null);
  assert.ok(isToolUnlocked(state,'airport'));
  assert.ok(isToolUnlocked(state,'university'));
});

test('earlier seven-rank saves migrate to three stages by population while retaining earned buildings and rewards',()=>{
  const state=fixture(6000);
  delete state.progression.counters.progressionStages;
  state.progression.rank=4;
  state.progression.unlocked.push('airport','university');
  state.progression.xp=1000;
  state.progression.claimedQuests.push('first-roads');
  assert.equal(getRank(state).id,1,'Reading old rank4 must not imply the new final stage');
  normalizeProgression(state);
  assert.equal(state.progression.rank,1);
  assert.equal(state.progression.counters.progressionStages,3);
  assert.ok(isToolUnlocked(state,'airport'));
  assert.ok(isToolUnlocked(state,'university'));
  assert.equal(state.progression.xp,1000);
  assert.deepEqual(state.progression.claimedQuests,['first-roads']);
  state.stats.population=100;
  normalizeProgression(state);
  assert.equal(state.progression.rank,1,'Migration runs once and later population loss preserves the new stage');
});
