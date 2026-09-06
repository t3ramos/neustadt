import type { CityState, Tool } from './types';
import { TOOL_DEFS } from './simulation';
import {
  CHALLENGES, QUESTS, RANKS, getCampaignProgress, getChallengeProgress, getQuestProgress, getRank,
  type QuestDefinition,
} from './progression';
import './progression-ui.css';

export type ProgressionTab='quests'|'ranks'|'challenges'|'goal';
const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const format=(value:number)=>Math.round(value).toLocaleString('de-DE');
const icon=(name:string)=>`<i data-lucide="${escape(name.replace(/([a-z])([A-Z])/g,'$1-$2').toLowerCase())}" aria-hidden="true"></i>`;
const percentage=(current:number,target:number)=>Math.max(0,Math.min(100,target>0?current/target*100:0));
const track=(current:number,target:number,label:string,extra='')=>`<div class="progression-track ${extra}" role="progressbar" aria-label="${escape(label)}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.max(0,Math.min(target,current))}" aria-valuetext="${escape(label)}"><span style="width:${percentage(current,target)}%"></span></div>`;
const QUEST_ICONS:Record<string,string>={'first-roads':'route','new-homes':'house','shape-land':'mountain','utility-network':'cable','reliable-services':'shield-check','local-jobs':'briefcase-business','urban-nature':'trees','healthy-city':'heart-pulse','balanced-books':'chart-no-axes-combined','knowledge-city':'graduation-cap','coastal-trade':'ship','clean-energy':'wind','international-city':'plane','city-of-tomorrow':'sparkles'};
const CHALLENGE_ICONS:Record<string,string>={'growth-spurt':'trending-up','green-capital':'leaf','treasury-builder':'landmark'};
const friendlyTool=(tool:Tool)=>TOOL_DEFS[tool]?.name??({inspect:'Untersuchen',pan:'Kamera',bulldoze:'Abreißen',raise:'Anheben',lower:'Absenken',level:'Einebnen',pipe:'Wasserrohre',powerline:'Stromleitungen',wind:'Windkraft',solar:'Solarpark',university:'Universität',recycling:'Recyclingzentrum'} as Partial<Record<Tool,string>>)[tool]??tool;
const reward=(money:number,xp:number)=>`<span class="progression-reward">${icon('coins')} ${format(money)} €</span><span class="progression-reward progression-xp">${icon('sparkles')} ${format(xp)} EP</span>`;

function tinyQuest(state:CityState,quest:QuestDefinition):string {
  const progress=getQuestProgress(state,quest.id);
  return `<div class="progression-mini-quest ${progress.complete?'is-ready':''}">
    <div class="progression-mini-heading">${icon(progress.complete?'circle-check':QUEST_ICONS[quest.id])}<strong>${escape(quest.name)}</strong></div>
    ${progress.complete?`<button class="progression-mini-claim" data-claim-quest="${quest.id}" aria-label="Belohnung für ${escape(quest.name)} abholen">${icon('gift')} ${format(quest.rewardMoney)} € abholen ${icon('arrow-right')}</button>`:`${track(progress.current,progress.target,progress.label)}<span class="progression-mini-count">${escape(progress.label)}</span>`}
  </div>`;
}

/** Inner HTML for the existing 250-pixel advisor panel. All actions are delegated by main.ts. */
export function renderProgressionSidebar(state:CityState):string {
  const rank=getRank(state);
  const claimed=state.progression.claimedQuests.length;
  const ready=QUESTS.filter(quest=>!state.progression.claimedQuests.includes(quest.id)&&getQuestProgress(state,quest.id).complete);
  const nextQuests=QUESTS.filter(quest=>!state.progression.claimedQuests.includes(quest.id)&&!ready.some(item=>item.id===quest.id));
  const visible=[...ready,...nextQuests].slice(0,3);
  const challenge=getChallengeProgress(state);
  const activeDefinition=CHALLENGES.find(item=>item.id===state.progression.activeChallenge?.id);
  const populationLabel=rank.next?`${format(state.stats.population)} / ${format(rank.next.population)} Einwohner`:`${format(state.stats.population)} Einwohner`;
  return `<div class="progression-sidebar">
    <div class="progression-side-kicker"><span>${icon('sprout')} DEINE STADT WÄCHST</span><span class="progression-level" title="Ausbaustufe ${rank.id+1} von ${RANKS.length}">${String(rank.id+1).padStart(2,'0')}</span></div>
    <div class="progression-side-title"><h2>${escape(rank.name)}</h2><span>${format(state.progression.xp)} EP</span></div>
    <div class="progression-next-rank"><span>${rank.next?`Nächste Stufe: <strong>${escape(rank.next.name)}</strong>`:'Höchste Ausbaustufe erreicht'}</span><small>${populationLabel}</small></div>
    ${track(rank.next?Math.max(0,state.stats.population-rank.population):1,rank.next?rank.next.population-rank.population:1,populationLabel)}
    ${rank.next?.unlocks.length?`<div class="progression-next-unlocks">${icon('lock-keyhole')} ${escape(rank.next.unlocks.slice(0,2).map(friendlyTool).join(' · '))}${rank.next.unlocks.length>2?` +${rank.next.unlocks.length-2}`:''}</div>`:''}
    ${state.progression.victory?`<button class="progression-victory-mini" data-open-progress="goal">${icon('trophy')} <span>Stadtziel gemeistert<strong>Deine Zukunftsstadt lebt weiter.</strong></span>${icon('chevron-right')}</button>`:''}
    <div class="progression-side-section"><span>DEINE NÄCHSTEN SCHRITTE</span><span>${claimed}/${QUESTS.length}</span></div>
    <div class="progression-mini-list">${visible.length?visible.map(quest=>tinyQuest(state,quest)).join(''):`<div class="progression-all-done">${icon('circle-check')} Alle Aufträge gemeistert. Genieße deine Stadt!</div>`}</div>
    ${challenge&&activeDefinition?`<button class="progression-side-challenge ${challenge.status}" data-open-progress="challenges">${icon(challenge.status==='completed'?'medal':challenge.status==='failed'?'clock-alert':'timer')}<span>${escape(activeDefinition.name)}<strong>${challenge.status==='active'?`Noch ${challenge.remainingMonths} Monate`:challenge.status==='completed'?'Challenge gemeistert':'Challenge beendet · Erneut versuchen'}</strong></span></button>`:''}
    <button class="progression-open" data-open-progress="quests"><span>Aufträge & Stadtziele${ready.length?`<b>${ready.length}</b>`:''}</span>${icon('arrow-up-right')}</button>
  </div>`;
}

function questCard(state:CityState,quest:QuestDefinition,index:number):string {
  const progress=getQuestProgress(state,quest.id),claimed=state.progression.claimedQuests.includes(quest.id);
  const status=claimed?'Abgeholt':progress.complete?'Belohnung bereit':'In Arbeit';
  return `<article class="progression-quest-card ${claimed?'is-claimed':progress.complete?'is-ready':''}">
    <div class="progression-card-top"><span class="progression-card-icon">${icon(claimed?'circle-check':QUEST_ICONS[quest.id])}</span><span class="progression-card-order">AUFTRAG ${String(index+1).padStart(2,'0')}</span><span class="progression-status ${claimed?'claimed':progress.complete?'ready':''}">${status}</span></div>
    <h3>${escape(quest.name)}</h3><p>${escape(quest.description)}</p>
    <div class="progression-quest-bottom"><div class="progression-metric-label">${escape(progress.label)}</div>${track(progress.current,progress.target,progress.label)}
    <div class="progression-rewards">${reward(quest.rewardMoney,quest.rewardXp)}</div>
    ${progress.complete&&!claimed?`<button class="progression-action claim" data-claim-quest="${quest.id}">${icon('gift')} Belohnung abholen ${icon('arrow-right')}</button>`:claimed?`<div class="progression-claim-status">${icon('check-check')} Belohnung erhalten</div>`:`<div class="progression-claim-status pending">${icon('circle-dashed')} Erfülle die Bedingungen</div>`}
    </div>
  </article>`;
}

function questsContent(state:CityState):string {
  const ready=QUESTS.filter(quest=>getQuestProgress(state,quest.id).complete&&!state.progression.claimedQuests.includes(quest.id)).length;
  return `<div class="progression-content-intro"><div><h3>Große Städte beginnen mit kleinen Schritten.</h3><p>Baue, verbessere und erfülle konkrete Aufgaben. Deine Belohnungen holst du selbst ab.</p></div><span class="progression-count-badge">${state.progression.claimedQuests.length} / ${QUESTS.length}<small>BELOHNUNGEN</small></span></div>
    ${ready?`<div class="progression-notice">${icon('gift')} ${ready===1?'Eine Belohnung wartet':`${ready} Belohnungen warten`} auf dich.</div>`:''}
    <div class="progression-quest-grid">${QUESTS.map((quest,index)=>questCard(state,quest,index)).join('')}</div>`;
}

function ranksContent(state:CityState):string {
  const rank=getRank(state);
  return `<div class="progression-content-intro"><div><h3>Drei Ausbaustufen. Eine lebendige Stadt.</h3><p>Kleinstadt, Großstadt, Metropole: Mit mehr Einwohnern werden neue Gebäude und dichtere Bebauung möglich. Erreichte Ausbaustufen bleiben dauerhaft erhalten.</p></div></div>
    <div class="progression-rank-list">${RANKS.map(entry=>{
      const achieved=rank.id>=entry.id,current=rank.id===entry.id;
      const unlocks=entry.unlocks.filter(tool=>TOOL_DEFS[tool]);
      return `<article class="progression-rank-row ${achieved?'is-achieved':''} ${current?'is-current':''}"><div class="progression-rank-marker">${achieved?icon(current?'flag':'check'):icon('lock-keyhole')}</div><div class="progression-rank-body"><div class="progression-rank-heading"><h3>${escape(entry.name)}</h3><span>${entry.population===0?'AB GRÜNDUNG':`${format(entry.population)} EINWOHNER`}</span></div><p>${escape(entry.description)}</p><div class="progression-unlocks">${entry.id===0?`<span>${icon('construction')} Straßen, Gebiete & Grundversorgung</span><span>${icon('mountain')} Gelände & Natur</span>`:unlocks.length?unlocks.map(tool=>`<span>${icon(TOOL_DEFS[tool]?.icon??'building-2')}${escape(friendlyTool(tool))}</span>`).join(''):`<span>${icon('trophy')} Das Stadtziel meistern</span>`}</div>${entry.id===2?`<div class="progression-stage-bonus">${icon('building-2')} Höchste Wohn- & Geschäftsgebäude</div>`:''}${current?`<span class="progression-current-rank">${icon('map-pin')} Deine aktuelle Ausbaustufe</span>`:''}</div></article>`;
    }).join('')}</div>
    <p class="progression-footnote">${icon('sparkles')} Erfahrungspunkte belohnen deine Bauaktionen und Erfolge. Neue Gebäude werden über den Einwohnerstand freigeschaltet.</p>`;
}

function challengesContent(state:CityState):string {
  const active=state.progression.activeChallenge,progress=getChallengeProgress(state);
  const current=CHALLENGES.find(item=>item.id===active?.id);
  return `<div class="progression-content-intro"><div><h3>Eine Stadt. Eine besondere Aufgabe.</h3><p>Wähle eine freiwillige Challenge. Es läuft immer eine gleichzeitig; die Zeit zählt in Spielmonaten. Erfolgreiche Challenges geben einmalig Geld, EP und ein Abzeichen.</p></div></div>
    ${progress&&current?`<div class="progression-active-challenge ${progress.status}"><div class="progression-active-header">${icon(progress.status==='completed'?'medal':progress.status==='failed'?'clock-alert':'timer')}<div><span>${progress.status==='active'?'DEINE LAUFENDE CHALLENGE':progress.status==='completed'?'CHALLENGE GEMEISTERT':'CHALLENGE BEENDET'}</span><h3>${escape(current.name)}</h3></div>${progress.status==='active'?`<strong>${progress.remainingMonths}<small>MONATE ÜBRIG</small></strong>`:''}</div><p>${escape(progress.label)}</p>${track(progress.current,progress.target,progress.label)}${progress.status==='failed'?`<p class="progression-challenge-hint">Du kannst dieselbe Challenge erneut starten oder eine andere wählen.</p>`:''}</div>`:''}
    <div class="progression-challenge-grid">${CHALLENGES.map(challenge=>{
      const completed=state.progression.completedChallenges.includes(challenge.id),running=active?.id===challenge.id&&active.status==='active',busy=active?.status==='active';
      return `<article class="progression-challenge-card ${completed?'is-completed':''}"><div class="progression-challenge-illustration">${icon(completed?'medal':CHALLENGE_ICONS[challenge.id])}<span>${challenge.durationMonths} MONATE</span></div><h3>${escape(challenge.name)}</h3><p>${escape(challenge.description)}</p><div class="progression-rewards">${reward(challenge.rewardMoney,challenge.rewardXp)}</div>${completed?`<div class="progression-earned-badge">${icon('badge-check')} Abzeichen erhalten</div>`:running?`<div class="progression-earned-badge running">${icon('timer')} Challenge läuft</div>`:`<button class="progression-action" data-start-challenge="${challenge.id}" ${busy?'disabled title="Schließe zuerst die laufende Challenge ab."':''}>${icon('flag')} ${active?.id===challenge.id&&active.status==='failed'?'Erneut versuchen':'Challenge starten'}</button>`}</article>`;
    }).join('')}</div>`;
}

function goalContent(state:CityState):string {
  const campaign=getCampaignProgress(state);
  const happyMonths=state.progression.counters.sustainableMonths??0;
  return `<div class="progression-goal-hero ${campaign.complete?'is-victorious':''}"><span class="progression-goal-symbol">${icon(campaign.complete?'trophy':'trees')}</span><span class="progression-goal-eyebrow">${campaign.complete?'STADTZIEL GEMEISTERT':'DEINE VISION FÜR '+escape(state.name.toLocaleUpperCase('de-DE'))}</span><h3>${campaign.complete?'Du hast Zukunft gebaut.':'Ein guter Ort. Für 25.000 Menschen.'}</h3><p>${campaign.complete?`${escape(state.name)} ist eine lebenswerte Zukunftsstadt. Dein Erfolg bleibt bestehen. Baue weiter, entdecke neue Stadtteile und meistere die Challenges.`:'Entwickle eine Metropole, in der Menschen gerne leben. Halte alle Ziele sechs Monate lang gleichzeitig und erwirtschafte dabei jeden Monat einen Überschuss.'}</p>${campaign.complete?`<span class="progression-freeplay-badge">${icon('infinity')} Freies Spiel · Deine Geschichte geht weiter</span>`:`<div class="progression-goal-totals"><span><strong>${format(state.stats.population)}</strong> / 25.000 Einwohner</span><span><strong>${Math.min(6,happyMonths)}</strong> / 6 stabile Monate</span></div>`}</div>
    <div class="progression-goal-requirements">${campaign.requirements.map((item,index)=>`<div class="progression-requirement ${item.complete?'is-complete':''}"><span class="progression-requirement-icon">${icon(item.complete?'circle-check':['users','smile','graduation-cap','heart-pulse','calendar-check'][index])}</span><div><div class="progression-requirement-label"><strong>${escape(item.label)}</strong><span>${format(item.current)} / ${format(item.target)}${index>0&&index<4?' %':''}</span></div>${track(item.current,item.target,item.label)}</div></div>`).join('')}</div>
    <div class="progression-goal-budget ${state.stats.balance>0?'positive':'negative'}">${icon('landmark')}<div><strong>Monatlicher Haushalt</strong><span>${state.stats.balance>0?'Die Stadt erzielt einen Überschuss.':'Für das Stadtziel brauchst du einen positiven monatlichen Haushalt.'}</span></div><b>${state.stats.balance>0?'+':''}${format(state.stats.balance)} €</b></div>
    ${campaign.complete&&!state.progression.claimedQuests.includes('city-of-tomorrow')?`<button class="progression-action claim progression-goal-claim" data-claim-quest="city-of-tomorrow">${icon('gift')} Stadtziel-Belohnung abholen · 25.000 € + 1.500 EP ${icon('arrow-right')}</button>`:''}
    <p class="progression-footnote">${icon('info')} ${campaign.complete?'Der Siegstatus bleibt dir auch dann erhalten, wenn deine Stadt sich später verändert.':'Sinkt während der sechs Monate ein Zielwert unter die Vorgabe oder wird der Haushalt negativ, beginnt die Serie wieder bei null. Aufträge und Challenges sind zusätzliche, freiwillige Ziele.'}</p>`;
}

/** Content for modalShell(..., true), with handlers supplied by main.ts. */
export function renderProgressionDialog(state:CityState,tab:ProgressionTab='quests'):string {
  const tabs:{id:ProgressionTab;name:string;icon:string}[]=[{id:'quests',name:'Aufträge',icon:'list-checks'},{id:'ranks',name:'Ausbaustufen',icon:'flag'},{id:'challenges',name:'Challenges',icon:'medal'},{id:'goal',name:'Stadtziel',icon:'trophy'}];
  const activeTab=tabs.some(item=>item.id===tab)?tab:'quests';
  const rank=getRank(state);
  return `<div class="progression-dialog"><div class="progression-dialog-summary"><span>${icon('sprout')} ${escape(rank.name)}<b>Stufe ${rank.id+1} / 3</b></span><span>${icon('sparkles')} ${format(state.progression.xp)} EP</span><span>${icon('medal')} ${state.progression.completedChallenges.length} / ${CHALLENGES.length} Abzeichen</span></div><nav class="progression-tabs" aria-label="Stadtfortschritt">${tabs.map(item=>`<button class="${activeTab===item.id?'active':''}" data-progress-tab="${item.id}" aria-current="${activeTab===item.id?'page':'false'}">${icon(item.icon)}<span>${item.name}</span>${item.id==='goal'&&state.progression.victory?'<b class="progression-tab-dot"></b>':''}</button>`).join('')}</nav><div class="progression-tab-content">${activeTab==='quests'?questsContent(state):activeTab==='ranks'?ranksContent(state):activeTab==='challenges'?challengesContent(state):goalContent(state)}</div></div>`;
}
