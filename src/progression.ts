import type { BuildResult, CityState, ProgressionState, Tile, Tool } from './types';
import { eventText, formatNumber, tr } from './i18n';

interface LocalizedDefinition {
  readonly name:string;
  readonly description:string;
  readonly nameDe:string;
  readonly nameEn:string;
  readonly descriptionDe:string;
  readonly descriptionEn:string;
}
export interface RankDefinition extends LocalizedDefinition {
  id:number;
  name:string;
  population:number;
  description:string;
  unlocks:Tool[];
}
export interface QuestDefinition extends LocalizedDefinition {
  id:string;
  name:string;
  description:string;
  target:number;
  rewardMoney:number;
  rewardXp:number;
}
export interface ChallengeDefinition extends LocalizedDefinition {
  id:string;
  name:string;
  description:string;
  target:number;
  durationMonths:number;
  rewardMoney:number;
  rewardXp:number;
}
export interface QuestProgress { current:number; target:number; complete:boolean; label:string; }
export interface ChallengeProgress {
  current:number; target:number; remainingMonths:number; label:string;
  status:'active'|'completed'|'failed';
}
export interface CampaignRequirement { label:string; current:number; target:number; complete:boolean; }

/** Keep save identifiers and canonical event text stable while rendering the current language. */
function localized<T extends {name:string;description:string}>(definition:T,nameEn:string,descriptionEn:string):T & LocalizedDefinition {
  const nameDe=definition.name,descriptionDe=definition.description;
  return {...definition,nameDe,nameEn,descriptionDe,descriptionEn,get name(){return tr(nameDe,nameEn);},get description(){return tr(descriptionDe,descriptionEn);}};
}

const CORE_TOOLS:Tool[] = ['inspect','pan','citizen','bulldoze','road','residential','commercial','industrial','power','waterpump','pipe','powerline','park','tree','police','fire','school','hospital','raise','lower','level'];
export const RANKS:RankDefinition[] = [
  localized({id:0,name:'Kleinstadt',population:0,description:'Baue eine gut versorgte Stadt mit Wohnvierteln, kleinen Betrieben und vollständiger Grundversorgung. Gebäude entwickeln sich bis Stufe 2.',unlocks:CORE_TOOLS},"Small Town","Build a well-served town with neighborhoods, small businesses and all essential services. Buildings can grow to level 2."),
  localized({id:1,name:'Großstadt',population:5000,description:'Bahn, Wind- und Solarenergie, Stadion, Hafen und Recycling werden verfügbar. Deine Stadt wächst mit dichterer Bebauung bis Gebäudestufe 3.',unlocks:['rail','wind','solar','stadium','seaport','recycling']},"City","Railways, wind and solar power, the stadium, seaport and recycling become available. Denser development lets your city grow to building level 3."),
  localized({id:2,name:'Metropole',population:15000,description:'Universität, Flughafen und die höchsten Wohn- und Geschäftshäuser prägen deine Metropole. Gebäude entwickeln sich bis Stufe 4.',unlocks:['university','airport']},"Metropolis","A university, airport and the tallest homes and offices shape your metropolis. Buildings can grow to level 4."),
];

export const QUESTS:QuestDefinition[] = [
  localized({id:'first-roads',name:'Neue Verbindungen',description:'Baue 10 neue Straßenfelder. Bereits vorhandene Straßen zählen nicht.',target:10,rewardMoney:1500,rewardXp:100},"New Connections","Build 10 new road tiles. Existing roads do not count."),
  localized({id:'new-homes',name:'Raum zum Ankommen',description:'Weise 12 neue Wohngebietsflächen aus und erreiche mindestens 500 Einwohner.',target:12,rewardMoney:2500,rewardXp:150},"Room to Settle","Zone 12 new residential tiles and reach at least 500 residents."),
  localized({id:'shape-land',name:'Das Land gestalten',description:'Verändere das Gelände 12-mal mit Anheben, Absenken oder Einebnen.',target:12,rewardMoney:1800,rewardXp:120},"Shaping the Land","Modify the terrain 12 times by raising, lowering or leveling it."),
  localized({id:'utility-network',name:'Unter und über der Stadt',description:'Verlege 8 Rohrfelder und baue 8 Stromleitungsfelder.',target:16,rewardMoney:2500,rewardXp:150},"Below and Above the City","Lay 8 pipe tiles and build 8 power line tiles."),
  localized({id:'reliable-services',name:'Eine verlässliche Stadt',description:'Verlege eigene Rohre und Stromleitungen. Versorge danach mindestens 95 % der bewohnten Wohnflächen 3 Monate in Folge mit Straße, Strom und Wasser.',target:3,rewardMoney:4000,rewardXp:250},"A Reliable City","Lay your own pipes and power lines. Then provide roads, electricity and water to at least 95% of occupied residential tiles for 3 consecutive months."),
  localized({id:'local-jobs',name:'Arbeit vor Ort',description:'Weise 12 neue Gewerbe- oder Industrieflächen aus. Versorge mindestens 500 Einwohner mit wenigstens einem Arbeitsplatz je 2 Einwohner.',target:12,rewardMoney:3500,rewardXp:200},"Local Jobs","Zone 12 new commercial or industrial tiles. Reach at least 500 residents and provide at least one job per 2 residents."),
  localized({id:'urban-nature',name:'Eine Stadt atmet auf',description:'Baue 15 Parks und pflanze 25 Bäume.',target:40,rewardMoney:4000,rewardXp:250},"A City Breathes Again","Build 15 parks and plant 25 trees."),
  localized({id:'healthy-city',name:'Gut versorgt',description:'Baue ein eigenes Krankenhaus. Erreiche mit mindestens 1.500 Einwohnern einen Gesundheitswert von 70.',target:1,rewardMoney:5000,rewardXp:300},"In Good Hands","Build your own hospital. Reach at least 1,500 residents and a health score of 70."),
  localized({id:'balanced-books',name:'Solide Finanzen',description:'Entwickle deine Stadt weiter und erwirtschafte 6 Monate in Folge einen positiven monatlichen Haushalt.',target:6,rewardMoney:6000,rewardXp:350},"Sound Finances","Develop your city and achieve a positive monthly budget for 6 consecutive months."),
  localized({id:'knowledge-city',name:'Stadt des Wissens',description:'Baue eine betriebsbereite Universität. Erreiche 15.000 Einwohner und einen Bildungswert von 70.',target:1,rewardMoney:8000,rewardXp:450},"City of Knowledge","Build an operational university. Reach 15,000 residents and an education score of 70."),
  localized({id:'coastal-trade',name:'Tor zum Meer',description:'Baue einen Hafen am Wasser und schließe ihn an Straße, Strom und Wasser an.',target:1,rewardMoney:7000,rewardXp:400},"Gateway to the Sea","Build a seaport by the water and connect it to roads, electricity and water."),
  localized({id:'clean-energy',name:'Saubere Zukunft',description:'Baue Wind- oder Solarenergie. Versorge 5.000 Einwohner ohne ein aktives fossiles Kraftwerk und ohne Stromdefizit.',target:1,rewardMoney:10000,rewardXp:500},"A Clean Future","Build wind or solar power. Supply 5,000 residents without an active fossil fuel power plant or an electricity deficit."),
  localized({id:'international-city',name:'Bereit zum Abheben',description:'Baue einen betriebsbereiten Flughafen für deine Metropole mit mindestens 15.000 Einwohnern.',target:1,rewardMoney:12000,rewardXp:600},"Ready for Takeoff","Build an operational airport for your metropolis of at least 15,000 residents."),
  localized({id:'city-of-tomorrow',name:'Die Stadt von morgen',description:'Erfülle das Stadtziel: 25.000 Einwohner, Zufriedenheit 80, Bildung und Gesundheit 70 und 6 gemeinsame Monate mit positivem Haushalt.',target:1,rewardMoney:25000,rewardXp:1500},"The City of Tomorrow","Achieve the city goal: 25,000 residents, happiness of 80, education and health of 70, and 6 consecutive months meeting all targets with a positive budget."),
];

export const CHALLENGES:ChallengeDefinition[] = [
  localized({id:'growth-spurt',name:'Aufbruch in die Metropole',description:'Gewinne innerhalb von 60 Monaten 5.000 zusätzliche Einwohner gegenüber dem Start dieser Challenge.',target:5000,durationMonths:60,rewardMoney:20000,rewardXp:1200},"Metropolitan Growth","Gain 5,000 additional residents within 60 months of starting this challenge."),
  localized({id:'green-capital',name:'Grüne Hauptstadt',description:'Erreiche innerhalb von 120 Monaten 10.000 Einwohner bei einer Umweltbelastung unter 10.',target:10000,durationMonths:120,rewardMoney:25000,rewardXp:1500},"Green Capital","Reach 10,000 residents with pollution below 10 within 120 months."),
  localized({id:'treasury-builder',name:'Goldene Stadtkasse',description:'Steigere die Stadtkasse innerhalb von 60 Monaten um 150.000. Jeder neue Kredit beendet diese Challenge.',target:150000,durationMonths:60,rewardMoney:15000,rewardXp:1000},"Golden Treasury","Increase the treasury by 150,000 within 60 months. Taking any new loan ends this challenge."),
];

const finite = (n:number|undefined) => Number.isFinite(n) ? Math.max(0,n!) : 0;
const counter = (state:CityState,key:string) => finite(state.progression.counters[key]);
const built = (state:CityState,tool:Tool) => counter(state,`built_${tool}`);
const rankForPopulation = (population:number) => RANKS.reduce((rank,entry)=>population>=entry.population?entry.id:rank,0);
const rootTile = (state:CityState,tile:Tile) => tile.anchor < 0 || tile.anchor === tile.z*state.size+tile.x;
const workingBuilding = (state:CityState,kind:Tool) => state.tiles.some(tile=>tile.kind===kind&&rootTile(state,tile)&&tile.connected&&tile.powered&&tile.watered&&tile.fire===0);
const activeGenerator = (state:CityState,kind:Tool) => state.tiles.some(tile=>tile.kind===kind&&rootTile(state,tile)&&tile.connected&&tile.fire===0);
const format = (value:number) => formatNumber(Math.round(value));
const formatDe = (value:number) => Math.round(value).toLocaleString('de-DE');
const formatEn = (value:number) => Math.round(value).toLocaleString('en-GB');

/** Initial towns get their actual population rank; imported buildings remain usable after population loss. */
export function createProgression(state?:Pick<CityState,'tiles'|'stats'>):ProgressionState {
  const rank = rankForPopulation(state?.stats.population??0);
  const known = new Set<Tool>(RANKS.flatMap(entry=>entry.unlocks));
  const unlocked = new Set<Tool>(RANKS.filter(entry=>entry.id<=rank).flatMap(entry=>entry.unlocks));
  for (const tile of state?.tiles??[]) if (known.has(tile.kind)) unlocked.add(tile.kind);
  return {xp:0,rank,completedQuests:[],claimedQuests:[],unlocked:[...unlocked],counters:{progressionStages:3,lastProgressMonth:-1,profitableMonths:0,servicedMonths:0,sustainableMonths:0,loansTaken:0},activeChallenge:null,completedChallenges:[],victory:false};
}

/** The earlier seven-rank preview used the same save version; preserve earned tools while mapping its rank to the new three stages. */
export function normalizeProgression(state:CityState):void {
  if (!state.progression) state.progression=createProgression(state);
  if (state.progression.counters.progressionStages!==3) {
    state.progression.rank=rankForPopulation(state.stats.population);
    state.progression.counters.progressionStages=3;
  }
  state.progression.rank=Math.max(0,Math.min(RANKS.length-1,Math.trunc(finite(state.progression.rank))));
}

export function getRank(state:CityState):RankDefinition & {next:RankDefinition|null} {
  const storedRank=state.progression.counters.progressionStages===3?state.progression.rank:0;
  const id = Math.max(rankForPopulation(state.stats.population),Math.min(RANKS.length-1,Math.trunc(finite(storedRank))));
  return {...RANKS[id],next:RANKS[id+1]??null};
}

export function isToolUnlocked(state:CityState,tool:Tool):boolean {
  return state.progression.unlocked.includes(tool)||RANKS.filter(rank=>rank.id<=getRank(state).id).some(rank=>rank.unlocks.includes(tool));
}

/** Called only for successful user construction; starter/imported buildings never manufacture quest progress. */
export function recordBuild(state:CityState,tool:Tool,count:number):void {
  count = Number.isFinite(count) ? Math.max(0,Math.floor(count)) : 0;
  if (!count || ['inspect','pan','citizen','empty','water','rubble'].includes(tool)) return;
  state.progression.counters[`built_${tool}`] = built(state,tool)+count;
  if (tool==='bulldoze') return;
  state.progression.counters.totalBuilt = counter(state,'totalBuilt')+count;
  if (['raise','lower','level'].includes(tool)) state.progression.counters.terrainTiles=counter(state,'terrainTiles')+count;
  // XP rewards actions, while population and city health determine actual progression and unlocks.
  const perTile = ['road','rail','pipe','powerline','tree','raise','lower','level'].includes(tool)?1:['residential','commercial','industrial'].includes(tool)?2:20;
  state.progression.xp += count*perTile;
}

function serviceCoverage(state:CityState):number {
  let homes=0,served=0;
  for (const tile of state.tiles) {
    if (tile.kind!=='residential'||tile.level===0) continue;
    homes++;
    if (tile.connected&&tile.powered&&tile.watered&&tile.fire===0) served++;
  }
  return homes ? served/homes*100 : 0;
}

function sustainable(state:CityState):boolean {
  return state.stats.population>=25000&&state.stats.happiness>=80&&state.stats.education>=70&&state.stats.health>=70&&state.stats.balance>0;
}

function questValue(state:CityState,id:string):number {
  switch(id) {
    case 'first-roads': return built(state,'road');
    case 'new-homes': return state.stats.population>=500?built(state,'residential'):0;
    case 'shape-land': return counter(state,'terrainTiles');
    case 'utility-network': return Math.min(8,built(state,'pipe'))+Math.min(8,built(state,'powerline'));
    case 'reliable-services': return counter(state,'servicedMonths');
    case 'local-jobs': return state.stats.population>=500&&state.stats.jobs>=state.stats.population*.5?built(state,'commercial')+built(state,'industrial'):0;
    case 'urban-nature': return Math.min(15,built(state,'park'))+Math.min(25,built(state,'tree'));
    case 'healthy-city': return built(state,'hospital')>0&&workingBuilding(state,'hospital')&&state.stats.population>=1500&&state.stats.health>=70?1:0;
    case 'balanced-books': return counter(state,'totalBuilt')>0?counter(state,'profitableMonths'):0;
    case 'knowledge-city': return built(state,'university')>0&&workingBuilding(state,'university')&&state.stats.population>=15000&&state.stats.education>=70?1:0;
    case 'coastal-trade': return built(state,'seaport')>0&&workingBuilding(state,'seaport')?1:0;
    case 'clean-energy': return built(state,'wind')+built(state,'solar')>0&&(activeGenerator(state,'wind')||activeGenerator(state,'solar'))&&!activeGenerator(state,'power')&&state.stats.population>=5000&&state.stats.powerSupply>=state.stats.powerDemand&&serviceCoverage(state)>=95?1:0;
    case 'international-city': return built(state,'airport')>0&&workingBuilding(state,'airport')&&state.stats.population>=15000?1:0;
    case 'city-of-tomorrow': return state.progression.victory?1:0;
    default: return 0;
  }
}

export function getQuestProgress(state:CityState,id:string):QuestProgress {
  const quest = QUESTS.find(item=>item.id===id);
  if (!quest) return {current:0,target:1,complete:false,label:tr('Unbekannter Auftrag','Unknown quest')};
  const complete = state.progression.completedQuests.includes(id)||questValue(state,id)>=quest.target;
  const current = complete?quest.target:Math.min(quest.target,questValue(state,id));
  let label = `${format(current)} / ${format(quest.target)}`;
  if (id==='utility-network') label=`${tr('Rohre','Pipes')} ${format(Math.min(8,built(state,'pipe')))}/8 · ${tr('Stromleitungen','Power lines')} ${format(Math.min(8,built(state,'powerline')))}/8`;
  if (id==='urban-nature') label=`Parks ${format(Math.min(15,built(state,'park')))}/15 · ${tr('Bäume','Trees')} ${format(Math.min(25,built(state,'tree')))}/25`;
  if (id==='reliable-services') label=`${format(current)}/3 ${tr('Monate · Versorgung','months · Service coverage')} ${format(serviceCoverage(state))} %`;
  if (id==='balanced-books') label=`${format(current)}/6 ${tr('positive Monate','profitable months')}`;
  if (id==='new-homes') label=`${tr('Wohnflächen','Residential tiles')} ${format(Math.min(12,built(state,'residential')))}/12 · ${tr('Einwohner','Residents')} ${format(state.stats.population)}/500`;
  if (id==='local-jobs') label=`${tr('Arbeitsflächen','Job tiles')} ${format(Math.min(12,built(state,'commercial')+built(state,'industrial')))}/12 · Jobs ${format(state.stats.jobs)}/${format(Math.ceil(state.stats.population*.5))}`;
  return {current,target:quest.target,complete,label};
}

function addEvent(state:CityState,titleDe:string,titleEn:string,messageDe:string,messageEn:string,type:'info'|'good'|'warning'='good'):void {
  const id=state.events.reduce((max,event)=>Math.max(max,event.id),0)+1;
  state.events.unshift({id,month:state.month,...eventText(titleDe,titleEn,messageDe,messageEn),type});
  state.events=state.events.slice(0,40);
}

export function claimQuest(state:CityState,id:string):BuildResult {
  const quest=QUESTS.find(item=>item.id===id);
  if (!quest) return {ok:false,message:tr('Dieser Auftrag existiert nicht.','This quest does not exist.'),cost:0,count:0};
  if (state.progression.claimedQuests.includes(id)) return {ok:false,message:tr('Diese Belohnung wurde bereits abgeholt.','This reward has already been claimed.'),cost:0,count:0};
  if (!getQuestProgress(state,id).complete) return {ok:false,message:tr('Die Bedingungen für diesen Auftrag sind noch nicht erfüllt.','The requirements for this quest have not been met yet.'),cost:0,count:0};
  if (!state.progression.completedQuests.includes(id)) state.progression.completedQuests.push(id);
  state.progression.claimedQuests.push(id);
  state.money+=quest.rewardMoney;
  state.progression.xp+=quest.rewardXp;
  state.revision++;
  const messageDe=`${quest.nameDe}: +${formatDe(quest.rewardMoney)} € und +${formatDe(quest.rewardXp)} EP.`;
  const messageEn=`${quest.nameEn}: +€${formatEn(quest.rewardMoney)} and +${formatEn(quest.rewardXp)} XP.`;
  addEvent(state,'Belohnung erhalten','Reward received',messageDe,messageEn);
  return {ok:true,message:tr(messageDe,messageEn),cost:-quest.rewardMoney,count:1};
}

export function startChallenge(state:CityState,id:string):BuildResult {
  const challenge=CHALLENGES.find(item=>item.id===id);
  if (!challenge) return {ok:false,message:tr('Diese Challenge existiert nicht.','This challenge does not exist.'),cost:0,count:0};
  if (state.progression.activeChallenge?.status==='active') return {ok:false,message:tr('Schließe zuerst deine laufende Challenge ab.','Finish your current challenge first.'),cost:0,count:0};
  if (state.progression.completedChallenges.includes(id)) return {ok:false,message:tr('Du hast diese Challenge bereits gemeistert.','You have already completed this challenge.'),cost:0,count:0};
  state.progression.activeChallenge={id,startedMonth:state.month,status:'active'};
  Object.assign(state.progression.counters,{challengePopulation:state.stats.population,challengeMoney:state.money,challengeLoan:state.loan,challengeLoansTaken:counter(state,'loansTaken')});
  state.revision++;
  const messageDe=`${challenge.nameDe} gestartet. Du hast ${formatDe(challenge.durationMonths)} Monate. ${challenge.descriptionDe}`;
  const messageEn=`${challenge.nameEn} started. You have ${formatEn(challenge.durationMonths)} months. ${challenge.descriptionEn}`;
  addEvent(state,'Challenge gestartet','Challenge started',messageDe,messageEn,'info');
  return {ok:true,message:tr(messageDe,messageEn),cost:0,count:1};
}

export function getChallengeProgress(state:CityState):ChallengeProgress|null {
  const active=state.progression.activeChallenge;
  if (!active) return null;
  const definition=CHALLENGES.find(item=>item.id===active.id);
  if (!definition) return null;
  let current=0,label='';
  if (active.id==='growth-spurt') {
    current=Math.max(0,state.stats.population-counter(state,'challengePopulation'));
    label=`${format(current)} / ${format(5000)} ${tr('neue Einwohner','new residents')}`;
  } else if (active.id==='green-capital') {
    current=state.stats.population;
    label=`${format(current)} / ${format(10000)} ${tr('Einwohner · Umweltbelastung','residents · Pollution')} ${format(state.stats.pollution)} / ${tr('unter 10','below 10')}`;
  } else {
    const baseline=state.progression.counters.challengeMoney;
    current=Math.max(0,state.money-(Number.isFinite(baseline)?baseline:0));
    label=tr(`${format(current)} / ${format(150000)} € Zuwachs · kein neuer Kredit`,`€${format(current)} / €${format(150000)} increase · no new loans`);
  }
  if (active.status==='failed') label=`${tr('Nicht geschafft','Not completed')} · ${label}`;
  if (active.status==='completed') label=`${tr('Gemeistert','Completed')} · ${definition.name}`;
  return {current:Math.min(definition.target,current),target:definition.target,remainingMonths:Math.max(0,active.startedMonth+definition.durationMonths-state.month),label,status:active.status};
}

function updateChallenge(state:CityState):void {
  const active=state.progression.activeChallenge;
  const progress=getChallengeProgress(state);
  if (!active||active.status!=='active'||!progress) return;
  const definition=CHALLENGES.find(item=>item.id===active.id)!;
  const borrowed=active.id==='treasury-builder'&&(counter(state,'loansTaken')>counter(state,'challengeLoansTaken')||state.loan>counter(state,'challengeLoan'));
  const deadline=active.startedMonth+definition.durationMonths;
  const eligibleMonth=state.month>active.startedMonth&&state.month<=deadline;
  const success=eligibleMonth&&!borrowed&&progress.current>=progress.target&&(active.id!=='green-capital'||state.stats.pollution<10);
  if (success) {
    active.status='completed';
    if (!state.progression.completedChallenges.includes(active.id)) {
      state.progression.completedChallenges.push(active.id);
      state.money+=definition.rewardMoney;
      state.progression.xp+=definition.rewardXp;
      addEvent(state,'Challenge gemeistert','Challenge completed',`${definition.nameDe}: +${formatDe(definition.rewardMoney)} € und +${formatDe(definition.rewardXp)} EP. Dein Abzeichen bleibt erhalten.`,`${definition.nameEn}: +€${formatEn(definition.rewardMoney)} and +${formatEn(definition.rewardXp)} XP. Your badge is yours to keep.`);
      state.revision++;
    }
  } else if (borrowed||state.month>=deadline) {
    active.status='failed';
    addEvent(state,'Challenge beendet','Challenge ended',borrowed?'Ein neuer Kredit hat „Goldene Stadtkasse“ beendet. Du kannst die Challenge erneut versuchen.':`${definition.nameDe}: Die Zeit ist abgelaufen. Du kannst es erneut versuchen.`,borrowed?'A new loan ended “Golden Treasury”. You can try the challenge again.':`${definition.nameEn}: Time has run out. You can try again.`,'warning');
    state.revision++;
  }
}

/** Call monthly:true once after a completed simulation month. Duplicate calls never advance streaks. */
export function updateProgression(state:CityState,options:{monthly?:boolean}={}):void {
  normalizeProgression(state);
  const progression=state.progression;
  const rank=getRank(state);
  if (rank.id>progression.rank) {
    progression.rank=rank.id;
    addEvent(state,`Ausbaustufe erreicht: ${rank.nameDe}`,`Development stage reached: ${rank.nameEn}`,`${formatDe(rank.population)} Einwohner erreicht. ${rank.descriptionDe}`,`${formatEn(rank.population)} residents reached. ${rank.descriptionEn}`);
  }
  const unlocks=new Set(progression.unlocked);
  for (const entry of RANKS) if (entry.id<=progression.rank) for (const tool of entry.unlocks) unlocks.add(tool);
  progression.unlocked=[...unlocks];
  if (options.monthly && progression.counters.lastProgressMonth!==state.month) {
    const consecutive=progression.counters.lastProgressMonth===state.month-1;
    const step=(key:string,condition:boolean)=>{progression.counters[key]=condition?(consecutive?counter(state,key):0)+1:0;};
    step('profitableMonths',state.stats.balance>0&&counter(state,'totalBuilt')>0);
    step('servicedMonths',state.stats.population>0&&built(state,'pipe')>=8&&built(state,'powerline')>=8&&serviceCoverage(state)>=95);
    step('sustainableMonths',sustainable(state));
    progression.counters.lastProgressMonth=state.month;
  }
  if (!progression.victory&&counter(state,'sustainableMonths')>=6&&sustainable(state)) {
    progression.victory=true;
    addEvent(state,'Stadtziel erreicht — deine Zukunftsstadt!','City goal achieved — your city of tomorrow!',`${state.name} hat sechs Monate lang mindestens 25.000 Einwohner, hohe Lebensqualität und einen positiven Haushalt gehalten. Du hast die Kampagne gemeistert. Baue im freien Spiel weiter!`,`${state.name} has maintained at least 25,000 residents, a high quality of life and a positive budget for six months. You have completed the campaign. Keep building in free play!`);
  }
  for (const quest of QUESTS) {
    if (progression.completedQuests.includes(quest.id)||questValue(state,quest.id)<quest.target) continue;
    progression.completedQuests.push(quest.id);
    addEvent(state,'Auftrag abgeschlossen','Quest completed',`${quest.nameDe} — hole ${formatDe(quest.rewardMoney)} € und ${formatDe(quest.rewardXp)} EP im Stadtziel-Fenster ab.`,`${quest.nameEn} — claim €${formatEn(quest.rewardMoney)} and ${formatEn(quest.rewardXp)} XP in the city goals window.`);
  }
  updateChallenge(state);
}

export function getCampaignProgress(state:CityState):{current:number;target:number;complete:boolean;label:string;requirements:CampaignRequirement[]} {
  const requirement=(label:string,current:number,target:number):CampaignRequirement=>({label,current,target,complete:current>=target});
  const requirements:CampaignRequirement[]=[
    requirement(tr('Einwohner','Residents'),state.stats.population,25000),
    requirement(tr('Zufriedenheit','Happiness'),state.stats.happiness,80),
    requirement(tr('Bildung','Education'),state.stats.education,70),
    requirement(tr('Gesundheit','Health'),state.stats.health,70),
    requirement(tr('Monate mit allen Zielen und positivem Haushalt','Months meeting all targets with a positive budget'),counter(state,'sustainableMonths'),6),
  ];
  const current=state.progression.victory?requirements.length:requirements.filter(item=>item.complete).length;
  return {current,target:requirements.length,complete:state.progression.victory,label:state.progression.victory?tr('Stadtziel gemeistert · Freies Spiel','City goal completed · Free play'):tr('Dein Ziel: eine lebenswerte Zukunftsstadt','Your goal: a city of tomorrow worth living in'),requirements};
}
