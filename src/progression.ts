import type { BuildResult, CityState, ProgressionState, Tile, Tool } from './types';

export interface RankDefinition {
  id:number;
  name:string;
  population:number;
  description:string;
  unlocks:Tool[];
}
export interface QuestDefinition {
  id:string;
  name:string;
  description:string;
  target:number;
  rewardMoney:number;
  rewardXp:number;
}
export interface ChallengeDefinition {
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

const CORE_TOOLS:Tool[] = ['inspect','pan','citizen','bulldoze','road','residential','commercial','industrial','power','waterpump','pipe','powerline','park','tree','police','fire','school','hospital','raise','lower','level'];
export const RANKS:RankDefinition[] = [
  {id:0,name:'Kleinstadt',population:0,description:'Baue eine gut versorgte Stadt mit Wohnvierteln, kleinen Betrieben und vollständiger Grundversorgung. Gebäude entwickeln sich bis Stufe 2.',unlocks:CORE_TOOLS},
  {id:1,name:'Großstadt',population:5000,description:'Bahn, Wind- und Solarenergie, Stadion, Hafen und Recycling werden verfügbar. Deine Stadt wächst mit dichterer Bebauung bis Gebäudestufe 3.',unlocks:['rail','wind','solar','stadium','seaport','recycling']},
  {id:2,name:'Metropole',population:15000,description:'Universität, Flughafen und die höchsten Wohn- und Geschäftshäuser prägen deine Metropole. Gebäude entwickeln sich bis Stufe 4.',unlocks:['university','airport']},
];

export const QUESTS:QuestDefinition[] = [
  {id:'first-roads',name:'Neue Verbindungen',description:'Baue 10 neue Straßenfelder. Bereits vorhandene Straßen zählen nicht.',target:10,rewardMoney:1500,rewardXp:100},
  {id:'new-homes',name:'Raum zum Ankommen',description:'Weise 12 neue Wohngebietsflächen aus und erreiche mindestens 500 Einwohner.',target:12,rewardMoney:2500,rewardXp:150},
  {id:'shape-land',name:'Das Land gestalten',description:'Verändere das Gelände 12-mal mit Anheben, Absenken oder Einebnen.',target:12,rewardMoney:1800,rewardXp:120},
  {id:'utility-network',name:'Unter und über der Stadt',description:'Verlege 8 Rohrfelder und baue 8 Stromleitungsfelder.',target:16,rewardMoney:2500,rewardXp:150},
  {id:'reliable-services',name:'Eine verlässliche Stadt',description:'Verlege eigene Rohre und Stromleitungen. Versorge danach mindestens 95 % der bewohnten Wohnflächen 3 Monate in Folge mit Straße, Strom und Wasser.',target:3,rewardMoney:4000,rewardXp:250},
  {id:'local-jobs',name:'Arbeit vor Ort',description:'Weise 12 neue Gewerbe- oder Industrieflächen aus. Versorge mindestens 500 Einwohner mit wenigstens einem Arbeitsplatz je 2 Einwohner.',target:12,rewardMoney:3500,rewardXp:200},
  {id:'urban-nature',name:'Eine Stadt atmet auf',description:'Baue 15 Parks und pflanze 25 Bäume.',target:40,rewardMoney:4000,rewardXp:250},
  {id:'healthy-city',name:'Gut versorgt',description:'Baue ein eigenes Krankenhaus. Erreiche mit mindestens 1.500 Einwohnern einen Gesundheitswert von 70.',target:1,rewardMoney:5000,rewardXp:300},
  {id:'balanced-books',name:'Solide Finanzen',description:'Entwickle deine Stadt weiter und erwirtschafte 6 Monate in Folge einen positiven monatlichen Haushalt.',target:6,rewardMoney:6000,rewardXp:350},
  {id:'knowledge-city',name:'Stadt des Wissens',description:'Baue eine betriebsbereite Universität. Erreiche 15.000 Einwohner und einen Bildungswert von 70.',target:1,rewardMoney:8000,rewardXp:450},
  {id:'coastal-trade',name:'Tor zum Meer',description:'Baue einen Hafen am Wasser und schließe ihn an Straße, Strom und Wasser an.',target:1,rewardMoney:7000,rewardXp:400},
  {id:'clean-energy',name:'Saubere Zukunft',description:'Baue Wind- oder Solarenergie. Versorge 5.000 Einwohner ohne ein aktives fossiles Kraftwerk und ohne Stromdefizit.',target:1,rewardMoney:10000,rewardXp:500},
  {id:'international-city',name:'Bereit zum Abheben',description:'Baue einen betriebsbereiten Flughafen für deine Metropole mit mindestens 15.000 Einwohnern.',target:1,rewardMoney:12000,rewardXp:600},
  {id:'city-of-tomorrow',name:'Die Stadt von morgen',description:'Erfülle das Stadtziel: 25.000 Einwohner, Zufriedenheit 80, Bildung und Gesundheit 70 und 6 gemeinsame Monate mit positivem Haushalt.',target:1,rewardMoney:25000,rewardXp:1500},
];

export const CHALLENGES:ChallengeDefinition[] = [
  {id:'growth-spurt',name:'Aufbruch in die Metropole',description:'Gewinne innerhalb von 60 Monaten 5.000 zusätzliche Einwohner gegenüber dem Start dieser Challenge.',target:5000,durationMonths:60,rewardMoney:20000,rewardXp:1200},
  {id:'green-capital',name:'Grüne Hauptstadt',description:'Erreiche innerhalb von 120 Monaten 10.000 Einwohner bei einer Umweltbelastung unter 10.',target:10000,durationMonths:120,rewardMoney:25000,rewardXp:1500},
  {id:'treasury-builder',name:'Goldene Stadtkasse',description:'Steigere die Stadtkasse innerhalb von 60 Monaten um 150.000. Jeder neue Kredit beendet diese Challenge.',target:150000,durationMonths:60,rewardMoney:15000,rewardXp:1000},
];

const finite = (n:number|undefined) => Number.isFinite(n) ? Math.max(0,n!) : 0;
const counter = (state:CityState,key:string) => finite(state.progression.counters[key]);
const built = (state:CityState,tool:Tool) => counter(state,`built_${tool}`);
const rankForPopulation = (population:number) => RANKS.reduce((rank,entry)=>population>=entry.population?entry.id:rank,0);
const rootTile = (state:CityState,tile:Tile) => tile.anchor < 0 || tile.anchor === tile.z*state.size+tile.x;
const workingBuilding = (state:CityState,kind:Tool) => state.tiles.some(tile=>tile.kind===kind&&rootTile(state,tile)&&tile.connected&&tile.powered&&tile.watered&&tile.fire===0);
const activeGenerator = (state:CityState,kind:Tool) => state.tiles.some(tile=>tile.kind===kind&&rootTile(state,tile)&&tile.connected&&tile.fire===0);
const format = (value:number) => Math.round(value).toLocaleString('de-DE');

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
  if (!quest) return {current:0,target:1,complete:false,label:'Unbekannter Auftrag'};
  const complete = state.progression.completedQuests.includes(id)||questValue(state,id)>=quest.target;
  const current = complete?quest.target:Math.min(quest.target,questValue(state,id));
  let label = `${format(current)} / ${format(quest.target)}`;
  if (id==='utility-network') label=`Rohre ${format(Math.min(8,built(state,'pipe')))}/8 · Stromleitungen ${format(Math.min(8,built(state,'powerline')))}/8`;
  if (id==='urban-nature') label=`Parks ${format(Math.min(15,built(state,'park')))}/15 · Bäume ${format(Math.min(25,built(state,'tree')))}/25`;
  if (id==='reliable-services') label=`${format(current)}/3 Monate · Versorgung ${Math.round(serviceCoverage(state))} %`;
  if (id==='balanced-books') label=`${format(current)}/6 positive Monate`;
  if (id==='new-homes') label=`Wohnflächen ${format(Math.min(12,built(state,'residential')))}/12 · Einwohner ${format(state.stats.population)}/500`;
  if (id==='local-jobs') label=`Arbeitsflächen ${format(Math.min(12,built(state,'commercial')+built(state,'industrial')))}/12 · Jobs ${format(state.stats.jobs)}/${format(Math.ceil(state.stats.population*.5))}`;
  return {current,target:quest.target,complete,label};
}

function addEvent(state:CityState,title:string,message:string,type:'info'|'good'|'warning'='good'):void {
  const id=state.events.reduce((max,event)=>Math.max(max,event.id),0)+1;
  state.events.unshift({id,month:state.month,title,message,type});
  state.events=state.events.slice(0,40);
}

export function claimQuest(state:CityState,id:string):BuildResult {
  const quest=QUESTS.find(item=>item.id===id);
  if (!quest) return {ok:false,message:'Dieser Auftrag existiert nicht.',cost:0,count:0};
  if (state.progression.claimedQuests.includes(id)) return {ok:false,message:'Diese Belohnung wurde bereits abgeholt.',cost:0,count:0};
  if (!getQuestProgress(state,id).complete) return {ok:false,message:'Die Bedingungen für diesen Auftrag sind noch nicht erfüllt.',cost:0,count:0};
  if (!state.progression.completedQuests.includes(id)) state.progression.completedQuests.push(id);
  state.progression.claimedQuests.push(id);
  state.money+=quest.rewardMoney;
  state.progression.xp+=quest.rewardXp;
  state.revision++;
  const message=`${quest.name}: +${format(quest.rewardMoney)} € und +${format(quest.rewardXp)} EP.`;
  addEvent(state,'Belohnung erhalten',message);
  return {ok:true,message,cost:-quest.rewardMoney,count:1};
}

export function startChallenge(state:CityState,id:string):BuildResult {
  const challenge=CHALLENGES.find(item=>item.id===id);
  if (!challenge) return {ok:false,message:'Diese Challenge existiert nicht.',cost:0,count:0};
  if (state.progression.activeChallenge?.status==='active') return {ok:false,message:'Schließe zuerst deine laufende Challenge ab.',cost:0,count:0};
  if (state.progression.completedChallenges.includes(id)) return {ok:false,message:'Du hast diese Challenge bereits gemeistert.',cost:0,count:0};
  state.progression.activeChallenge={id,startedMonth:state.month,status:'active'};
  Object.assign(state.progression.counters,{challengePopulation:state.stats.population,challengeMoney:state.money,challengeLoan:state.loan,challengeLoansTaken:counter(state,'loansTaken')});
  state.revision++;
  const message=`${challenge.name} gestartet. Du hast ${challenge.durationMonths} Monate. ${challenge.description}`;
  addEvent(state,'Challenge gestartet',message,'info');
  return {ok:true,message,cost:0,count:1};
}

export function getChallengeProgress(state:CityState):ChallengeProgress|null {
  const active=state.progression.activeChallenge;
  if (!active) return null;
  const definition=CHALLENGES.find(item=>item.id===active.id);
  if (!definition) return null;
  let current=0,label='';
  if (active.id==='growth-spurt') {
    current=Math.max(0,state.stats.population-counter(state,'challengePopulation'));
    label=`${format(current)} / 5.000 neue Einwohner`;
  } else if (active.id==='green-capital') {
    current=state.stats.population;
    label=`${format(current)} / 10.000 Einwohner · Umweltbelastung ${Math.round(state.stats.pollution)} / unter 10`;
  } else {
    const baseline=state.progression.counters.challengeMoney;
    current=Math.max(0,state.money-(Number.isFinite(baseline)?baseline:0));
    label=`${format(current)} / 150.000 € Zuwachs · kein neuer Kredit`;
  }
  if (active.status==='failed') label=`Nicht geschafft · ${label}`;
  if (active.status==='completed') label=`Gemeistert · ${definition.name}`;
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
      addEvent(state,'Challenge gemeistert',`${definition.name}: +${format(definition.rewardMoney)} € und +${format(definition.rewardXp)} EP. Dein Abzeichen bleibt erhalten.`);
      state.revision++;
    }
  } else if (borrowed||state.month>=deadline) {
    active.status='failed';
    addEvent(state,'Challenge beendet',borrowed?'Ein neuer Kredit hat „Goldene Stadtkasse“ beendet. Du kannst die Challenge erneut versuchen.':`${definition.name}: Die Zeit ist abgelaufen. Du kannst es erneut versuchen.`,'warning');
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
    addEvent(state,`Ausbaustufe erreicht: ${rank.name}`,`${format(rank.population)} Einwohner erreicht. ${rank.description}`);
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
    addEvent(state,'Stadtziel erreicht — deine Zukunftsstadt!',`${state.name} hat sechs Monate lang mindestens 25.000 Einwohner, hohe Lebensqualität und einen positiven Haushalt gehalten. Du hast die Kampagne gemeistert. Baue im freien Spiel weiter!`);
  }
  for (const quest of QUESTS) {
    if (progression.completedQuests.includes(quest.id)||questValue(state,quest.id)<quest.target) continue;
    progression.completedQuests.push(quest.id);
    addEvent(state,'Auftrag abgeschlossen',`${quest.name} — hole ${format(quest.rewardMoney)} € und ${format(quest.rewardXp)} EP im Stadtziel-Fenster ab.`);
  }
  updateChallenge(state);
}

export function getCampaignProgress(state:CityState):{current:number;target:number;complete:boolean;label:string;requirements:CampaignRequirement[]} {
  const requirement=(label:string,current:number,target:number):CampaignRequirement=>({label,current,target,complete:current>=target});
  const requirements:CampaignRequirement[]=[
    requirement('Einwohner',state.stats.population,25000),
    requirement('Zufriedenheit',state.stats.happiness,80),
    requirement('Bildung',state.stats.education,70),
    requirement('Gesundheit',state.stats.health,70),
    requirement('Monate mit allen Zielen und positivem Haushalt',counter(state,'sustainableMonths'),6),
  ];
  const current=state.progression.victory?requirements.length:requirements.filter(item=>item.complete).length;
  return {current,target:requirements.length,complete:state.progression.victory,label:state.progression.victory?'Stadtziel gemeistert · Freies Spiel':'Dein Ziel: eine lebenswerte Zukunftsstadt',requirements};
}
