import { ECONOMY_STEP_SECONDS, stepTime, perMinute } from '../simulation/calendar';
import type { CityState, Tool } from '../domain/types';
import { TOOL_DEFS } from '../simulation/city-simulation';
import { tr, localeCode, formatNumber, formatCurrency } from '../i18n/index';
import {
  CHALLENGES,
  QUESTS,
  RANKS,
  getCampaignProgress,
  getChallengeProgress,
  getQuestProgress,
  getRank,
  type QuestDefinition,
} from '../simulation/progression';
import './styles/progression.css';

export type ProgressionTab = 'quests' | 'ranks' | 'challenges' | 'goal';
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const format = (value: number) => formatNumber(Math.round(value));
const icon = (name: string) =>
  `<i data-lucide="${escape(name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase())}" aria-hidden="true"></i>`;
const percentage = (current: number, target: number) =>
  Math.max(0, Math.min(100, target > 0 ? (current / target) * 100 : 0));
const track = (current: number, target: number, label: string, extra = '') =>
  `<div class="progression-track ${extra}" role="progressbar" aria-label="${escape(label)}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.max(0, Math.min(target, current))}" aria-valuetext="${escape(label)}"><span style="width:${percentage(current, target)}%"></span></div>`;
const QUEST_ICONS: Record<string, string> = {
  'first-roads': 'route',
  'new-homes': 'house',
  'shape-land': 'mountain',
  'utility-network': 'cable',
  'reliable-services': 'shield-check',
  'local-jobs': 'briefcase-business',
  'urban-nature': 'trees',
  'healthy-city': 'heart-pulse',
  'balanced-books': 'chart-no-axes-combined',
  'knowledge-city': 'graduation-cap',
  'coastal-trade': 'ship',
  'clean-energy': 'wind',
  'international-city': 'plane',
  'city-of-tomorrow': 'sparkles',
};
const CHALLENGE_ICONS: Record<string, string> = {
  'growth-spurt': 'trending-up',
  'green-capital': 'leaf',
  'treasury-builder': 'landmark',
};
const friendlyTool = (tool: Tool) =>
  TOOL_DEFS[tool]?.name ??
  (
    {
      inspect: tr('Untersuchen', 'Inspect'),
      pan: tr('Kamera', 'Camera'),
      bulldoze: tr('Abreißen', 'Demolish'),
      raise: tr('Anheben', 'Raise'),
      lower: tr('Absenken', 'Lower'),
      level: tr('Einebnen', 'Flatten'),
      pipe: tr('Wasserrohre', 'Water pipes'),
      powerline: tr('Stromleitungen', 'Power lines'),
      wind: tr('Windkraft', 'Wind power'),
      solar: tr('Solarpark', 'Solar farm'),
      university: tr('Universität', 'University'),
      recycling: tr('Recyclingzentrum', 'Recycling center'),
    } as Partial<Record<Tool, string>>
  )[tool] ??
  tool;
const reward = (money: number, xp: number) =>
  `<span class="progression-reward">${icon('coins')} ${formatCurrency(money)}</span><span class="progression-reward progression-xp">${icon('sparkles')} ${format(xp)} ${tr('EP', 'XP')}</span>`;

function tinyQuest(state: CityState, quest: QuestDefinition): string {
  const progress = getQuestProgress(state, quest.id);
  return `<div class="progression-mini-quest ${progress.complete ? 'is-ready' : ''}">
    <div class="progression-mini-heading">${icon(progress.complete ? 'circle-check' : QUEST_ICONS[quest.id])}<strong>${escape(quest.name)}</strong></div>
    ${progress.complete ? `<button class="progression-mini-claim" data-claim-quest="${quest.id}" aria-label="${escape(tr(`Belohnung für ${quest.name} abholen`, `Claim reward for ${quest.name}`))}">${icon('gift')} ${tr(`${formatCurrency(quest.rewardMoney)} abholen`, `Claim ${formatCurrency(quest.rewardMoney)}`)} ${icon('arrow-right')}</button>` : `${track(progress.current, progress.target, progress.label)}<span class="progression-mini-count">${escape(progress.label)}</span>`}
  </div>`;
}

/** Inner HTML for the existing 250-pixel advisor panel. All actions are delegated by main.ts. */
export function renderProgressionSidebar(state: CityState): string {
  const rank = getRank(state);
  const claimed = state.progression.claimedQuests.length;
  const ready = QUESTS.filter(
    (quest) =>
      !state.progression.claimedQuests.includes(quest.id) &&
      getQuestProgress(state, quest.id).complete,
  );
  const nextQuests = QUESTS.filter(
    (quest) =>
      !state.progression.claimedQuests.includes(quest.id) &&
      !ready.some((item) => item.id === quest.id),
  );
  const visible = [...ready, ...nextQuests].slice(0, 3);
  const challenge = getChallengeProgress(state);
  const activeDefinition = CHALLENGES.find(
    (item) => item.id === state.progression.activeChallenge?.id,
  );
  const populationLabel = rank.next
    ? `${format(state.stats.population)} / ${format(rank.next.population)} ${tr('Einwohner', 'residents')}`
    : `${format(state.stats.population)} ${tr('Einwohner', 'residents')}`;
  return `<div class="progression-sidebar">
    <div class="progression-side-kicker"><span>${icon('sprout')} ${tr('DEINE STADT WÄCHST', 'YOUR CITY IS GROWING')}</span><span class="progression-level" title="${tr(`Ausbaustufe ${rank.id + 1} von ${RANKS.length}`, `City stage ${rank.id + 1} of ${RANKS.length}`)}">${String(rank.id + 1).padStart(2, '0')}</span></div>
    <div class="progression-side-title"><h2>${escape(rank.name)}</h2><span>${format(state.progression.xp)} ${tr('EP', 'XP')}</span></div>
    <div class="progression-next-rank"><span>${rank.next ? `${tr('Nächste Stufe:', 'Next stage:')} <strong>${escape(rank.next.name)}</strong>` : tr('Höchste Ausbaustufe erreicht', 'Highest city stage reached')}</span><small>${populationLabel}</small></div>
    ${track(rank.next ? Math.max(0, state.stats.population - rank.population) : 1, rank.next ? rank.next.population - rank.population : 1, populationLabel)}
    ${rank.next?.unlocks.length ? `<div class="progression-next-unlocks">${icon('lock-keyhole')} ${escape(rank.next.unlocks.slice(0, 2).map(friendlyTool).join(' · '))}${rank.next.unlocks.length > 2 ? ` +${rank.next.unlocks.length - 2}` : ''}</div>` : ''}
    ${state.progression.victory ? `<button class="progression-victory-mini" data-open-progress="goal">${icon('trophy')} <span>${tr('Stadtziel gemeistert', 'City goal achieved')}<strong>${tr('Deine Zukunftsstadt lebt weiter.', 'Your city of tomorrow keeps growing.')}</strong></span>${icon('chevron-right')}</button>` : ''}
    <div class="progression-side-section"><span>${tr('DEINE NÄCHSTEN SCHRITTE', 'YOUR NEXT STEPS')}</span><span>${format(claimed)}/${format(QUESTS.length)}</span></div>
    <div class="progression-mini-list">${visible.length ? visible.map((quest) => tinyQuest(state, quest)).join('') : `<div class="progression-all-done">${icon('circle-check')} ${tr('Alle Aufträge gemeistert. Genieße deine Stadt!', 'All quests completed. Enjoy your city!')}</div>`}</div>
    ${challenge && activeDefinition ? `<button class="progression-side-challenge ${challenge.status}" data-open-progress="challenges">${icon(challenge.status === 'completed' ? 'medal' : challenge.status === 'failed' ? 'clock-alert' : 'timer')}<span>${escape(activeDefinition.name)}<strong>${challenge.status === 'active' ? tr(`Noch ${stepTime(challenge.remainingMonths)} Spielzeit`, `${stepTime(challenge.remainingMonths)} time left`) : challenge.status === 'completed' ? tr('Challenge gemeistert', 'Challenge completed') : tr('Challenge beendet · Erneut versuchen', 'Challenge ended · Try again')}</strong></span></button>` : ''}
    <button class="progression-open" data-open-progress="quests"><span>${tr('Aufträge & Stadtziele', 'Quests & city goals')}${ready.length ? `<b>${format(ready.length)}</b>` : ''}</span>${icon('arrow-up-right')}</button>
  </div>`;
}

function questCard(state: CityState, quest: QuestDefinition, index: number): string {
  const progress = getQuestProgress(state, quest.id),
    claimed = state.progression.claimedQuests.includes(quest.id);
  const status = claimed
    ? tr('Abgeholt', 'Claimed')
    : progress.complete
      ? tr('Belohnung bereit', 'Reward ready')
      : tr('In Arbeit', 'In progress');
  return `<article class="progression-quest-card ${claimed ? 'is-claimed' : progress.complete ? 'is-ready' : ''}">
    <div class="progression-card-top"><span class="progression-card-icon">${icon(claimed ? 'circle-check' : QUEST_ICONS[quest.id])}</span><span class="progression-card-order">${tr('AUFTRAG', 'QUEST')} ${String(index + 1).padStart(2, '0')}</span><span class="progression-status ${claimed ? 'claimed' : progress.complete ? 'ready' : ''}">${status}</span></div>
    <h3>${escape(quest.name)}</h3><p>${escape(quest.description)}</p>
    <div class="progression-quest-bottom"><div class="progression-metric-label">${escape(progress.label)}</div>${track(progress.current, progress.target, progress.label)}
    <div class="progression-rewards">${reward(quest.rewardMoney, quest.rewardXp)}</div>
    ${progress.complete && !claimed ? `<button class="progression-action claim" data-claim-quest="${quest.id}">${icon('gift')} ${tr('Belohnung abholen', 'Claim reward')} ${icon('arrow-right')}</button>` : claimed ? `<div class="progression-claim-status">${icon('check-check')} ${tr('Belohnung erhalten', 'Reward received')}</div>` : `<div class="progression-claim-status pending">${icon('circle-dashed')} ${tr('Erfülle die Bedingungen', 'Complete the requirements')}</div>`}
    </div>
  </article>`;
}

function questsContent(state: CityState): string {
  const ready = QUESTS.filter(
    (quest) =>
      getQuestProgress(state, quest.id).complete &&
      !state.progression.claimedQuests.includes(quest.id),
  ).length;
  return `<div class="progression-content-intro"><div><h3>${tr('Große Städte beginnen mit kleinen Schritten.', 'Great cities begin with small steps.')}</h3><p>${tr('Baue, verbessere und erfülle konkrete Aufgaben. Deine Belohnungen holst du selbst ab.', 'Build, improve and complete specific tasks. Claim your rewards when you are ready.')}</p></div><span class="progression-count-badge">${format(state.progression.claimedQuests.length)} / ${format(QUESTS.length)}<small>${tr('BELOHNUNGEN', 'REWARDS')}</small></span></div>
    ${ready ? `<div class="progression-notice">${icon('gift')} ${ready === 1 ? tr('Eine Belohnung wartet auf dich.', 'One reward is waiting for you.') : tr(`${format(ready)} Belohnungen warten auf dich.`, `${format(ready)} rewards are waiting for you.`)}</div>` : ''}
    <div class="progression-quest-grid">${QUESTS.map((quest, index) => questCard(state, quest, index)).join('')}</div>`;
}

function ranksContent(state: CityState): string {
  const rank = getRank(state);
  return `<div class="progression-content-intro"><div><h3>${tr('Drei Ausbaustufen. Eine lebendige Stadt.', 'Three city stages. One lively city.')}</h3><p>${tr('Kleinstadt, Großstadt, Metropole: Mit mehr Einwohnern werden neue Gebäude und dichtere Bebauung möglich. Erreichte Ausbaustufen bleiben dauerhaft erhalten.', 'Town, city, metropolis: population growth unlocks new buildings and higher density. Every city stage you reach remains unlocked.')}</p></div></div>
    <div class="progression-rank-list">${RANKS.map((entry) => {
      const achieved = rank.id >= entry.id,
        current = rank.id === entry.id;
      const unlocks = entry.unlocks.filter((tool) => TOOL_DEFS[tool]);
      return `<article class="progression-rank-row ${achieved ? 'is-achieved' : ''} ${current ? 'is-current' : ''}"><div class="progression-rank-marker">${achieved ? icon(current ? 'flag' : 'check') : icon('lock-keyhole')}</div><div class="progression-rank-body"><div class="progression-rank-heading"><h3>${escape(entry.name)}</h3><span>${entry.population === 0 ? tr('AB GRÜNDUNG', 'FROM THE START') : `${format(entry.population)} ${tr('EINWOHNER', 'RESIDENTS')}`}</span></div><p>${escape(entry.description)}</p><div class="progression-unlocks">${entry.id === 0 ? `<span>${icon('construction')} ${tr('Straßen, Gebiete & Grundversorgung', 'Roads, zones & basic utilities')}</span><span>${icon('mountain')} ${tr('Gelände & Natur', 'Terrain & nature')}</span>` : unlocks.length ? unlocks.map((tool) => `<span>${icon(TOOL_DEFS[tool]?.icon ?? 'building-2')}${escape(friendlyTool(tool))}</span>`).join('') : `<span>${icon('trophy')} ${tr('Das Stadtziel meistern', 'Achieve the city goal')}</span>`}</div>${entry.id === 2 ? `<div class="progression-stage-bonus">${icon('building-2')} ${tr('Höchste Wohn- & Geschäftsgebäude', 'Tallest residential & commercial buildings')}</div>` : ''}${current ? `<span class="progression-current-rank">${icon('map-pin')} ${tr('Deine aktuelle Ausbaustufe', 'Your current city stage')}</span>` : ''}</div></article>`;
    }).join('')}</div>
    <p class="progression-footnote">${icon('sparkles')} ${tr('Erfahrungspunkte belohnen deine Bauaktionen und Erfolge. Neue Gebäude werden über den Einwohnerstand freigeschaltet.', 'Experience points reward construction and achievements. Your population unlocks new buildings.')}</p>`;
}

function challengesContent(state: CityState): string {
  const active = state.progression.activeChallenge,
    progress = getChallengeProgress(state);
  const current = CHALLENGES.find((item) => item.id === active?.id);
  return `<div class="progression-content-intro"><div><h3>${tr('Eine Stadt. Eine besondere Aufgabe.', 'One city. One special challenge.')}</h3><p>${tr('Wähle eine freiwillige Challenge. Es läuft immer eine gleichzeitig; die Zeit zählt in Spielminuten. Erfolgreiche Challenges geben einmalig Geld, EP und ein Abzeichen.', 'Choose an optional challenge. One runs at a time, with time measured in simulation minutes. Complete a challenge to earn a one-time reward of money, XP and a badge.')}</p></div></div>
    ${progress && current ? `<div class="progression-active-challenge ${progress.status}"><div class="progression-active-header">${icon(progress.status === 'completed' ? 'medal' : progress.status === 'failed' ? 'clock-alert' : 'timer')}<div><span>${progress.status === 'active' ? tr('DEINE LAUFENDE CHALLENGE', 'YOUR ACTIVE CHALLENGE') : progress.status === 'completed' ? tr('CHALLENGE GEMEISTERT', 'CHALLENGE COMPLETED') : tr('CHALLENGE BEENDET', 'CHALLENGE ENDED')}</span><h3>${escape(current.name)}</h3></div>${progress.status === 'active' ? `<strong>${stepTime(progress.remainingMonths)}<small>${tr('SPIELZEIT ÜBRIG', 'TIME LEFT')}</small></strong>` : ''}</div><p>${escape(progress.label)}</p>${track(progress.current, progress.target, progress.label)}${progress.status === 'failed' ? `<p class="progression-challenge-hint">${tr('Du kannst dieselbe Challenge erneut starten oder eine andere wählen.', 'You can restart this challenge or choose another one.')}</p>` : ''}</div>` : ''}
    <div class="progression-challenge-grid">${CHALLENGES.map((challenge) => {
      const completed = state.progression.completedChallenges.includes(challenge.id),
        running = active?.id === challenge.id && active.status === 'active',
        busy = active?.status === 'active';
      return `<article class="progression-challenge-card ${completed ? 'is-completed' : ''}"><div class="progression-challenge-illustration">${icon(completed ? 'medal' : CHALLENGE_ICONS[challenge.id])}<span>${stepTime(challenge.durationMonths)} ${tr('ZEITLIMIT', 'TIME LIMIT')}</span></div><h3>${escape(challenge.name)}</h3><p>${escape(challenge.description)}</p><div class="progression-rewards">${reward(challenge.rewardMoney, challenge.rewardXp)}</div>${completed ? `<div class="progression-earned-badge">${icon('badge-check')} ${tr('Abzeichen erhalten', 'Badge earned')}</div>` : running ? `<div class="progression-earned-badge running">${icon('timer')} ${tr('Challenge läuft', 'Challenge in progress')}</div>` : `<button class="progression-action" data-start-challenge="${challenge.id}" ${busy ? `disabled title="${tr('Schließe zuerst die laufende Challenge ab.', 'Finish the active challenge first.')}"` : ''}>${icon('flag')} ${active?.id === challenge.id && active.status === 'failed' ? tr('Erneut versuchen', 'Try again') : tr('Challenge starten', 'Start challenge')}</button>`}</article>`;
    }).join('')}</div>`;
}

function goalContent(state: CityState): string {
  const campaign = getCampaignProgress(state);
  const happyMonths = state.progression.counters.sustainableMonths ?? 0;
  return `<div class="progression-goal-hero ${campaign.complete ? 'is-victorious' : ''}"><span class="progression-goal-symbol">${icon(campaign.complete ? 'trophy' : 'trees')}</span><span class="progression-goal-eyebrow">${campaign.complete ? tr('STADTZIEL GEMEISTERT', 'CITY GOAL ACHIEVED') : tr('DEINE VISION FÜR ', 'YOUR VISION FOR ') + escape(state.name.toLocaleUpperCase(localeCode()))}</span><h3>${campaign.complete ? tr('Du hast Zukunft gebaut.', 'You built a better future.') : tr(`Ein guter Ort. Für ${format(25000)} Menschen.`, `A place to call home. For ${format(25000)} people.`)}</h3><p>${campaign.complete ? tr(`${escape(state.name)} ist eine lebenswerte Zukunftsstadt. Dein Erfolg bleibt bestehen. Baue weiter, entdecke neue Stadtteile und meistere die Challenges.`, `${escape(state.name)} is a thriving city of tomorrow. Your achievement is permanent. Keep building, discover new neighborhoods and take on challenges.`) : tr('Entwickle eine Metropole, in der Menschen gerne leben. Halte alle Ziele 30 Spielsekunden lang gleichzeitig und halte dabei die Bilanz im Plus.', 'Develop a metropolis where people love to live. Meet every target for 30 consecutive simulation seconds with a positive running balance.')}</p>${campaign.complete ? `<span class="progression-freeplay-badge">${icon('infinity')} ${tr('Freies Spiel · Deine Geschichte geht weiter', 'Free play · Your story continues')}</span>` : `<div class="progression-goal-totals"><span><strong>${format(state.stats.population)}</strong> / ${format(25000)} ${tr('Einwohner', 'residents')}</span><span><strong>${format(Math.min(6, happyMonths) * ECONOMY_STEP_SECONDS)}</strong> / 30 ${tr('stabile Sekunden', 'stable seconds')}</span></div>`}</div>
    <div class="progression-goal-requirements">${campaign.requirements.map((item, index) => `<div class="progression-requirement ${item.complete ? 'is-complete' : ''}"><span class="progression-requirement-icon">${icon(item.complete ? 'circle-check' : ['users', 'smile', 'graduation-cap', 'heart-pulse', 'calendar-check'][index])}</span><div><div class="progression-requirement-label"><strong>${escape(item.label)}</strong><span>${format(item.current)} / ${format(item.target)}${index > 0 && index < 4 ? ' %' : ''}</span></div>${track(item.current, item.target, item.label)}</div></div>`).join('')}</div>
    <div class="progression-goal-budget ${state.stats.balance > 0 ? 'positive' : 'negative'}">${icon('landmark')}<div><strong>${tr('Bilanz pro Minute', 'Balance per minute')}</strong><span>${state.stats.balance > 0 ? tr('Die Stadt erzielt einen Überschuss.', 'The city is earning a surplus.') : tr('Für das Stadtziel brauchst du eine positive laufende Bilanz.', 'The city goal requires a running budget surplus.')}</span></div><b>${state.stats.balance > 0 ? '+' : ''}${formatCurrency(perMinute(state.stats.balance))}</b></div>
    ${campaign.complete && !state.progression.claimedQuests.includes('city-of-tomorrow') ? `<button class="progression-action claim progression-goal-claim" data-claim-quest="city-of-tomorrow">${icon('gift')} ${tr('Stadtziel-Belohnung abholen', 'Claim city goal reward')} · ${formatCurrency(25000)} + ${format(1500)} ${tr('EP', 'XP')} ${icon('arrow-right')}</button>` : ''}
    <p class="progression-footnote">${icon('info')} ${campaign.complete ? tr('Der Siegstatus bleibt dir auch dann erhalten, wenn deine Stadt sich später verändert.', 'Your victory remains even if your city changes later.') : tr('Sinkt während dieser 30 Sekunden ein Zielwert unter die Vorgabe oder wird der Haushalt negativ, beginnt die Serie wieder bei null. Aufträge und Challenges sind zusätzliche, freiwillige Ziele.', 'If any target falls short or the budget turns negative during these 30 seconds, the streak resets to zero. Quests and challenges are additional, optional goals.')}</p>`;
}

/** Content for modalShell(..., true), with handlers supplied by main.ts. */
export function renderProgressionDialog(state: CityState, tab: ProgressionTab = 'quests'): string {
  const tabs: { id: ProgressionTab; name: string; icon: string }[] = [
    { id: 'quests', name: tr('Aufträge', 'Quests'), icon: 'list-checks' },
    { id: 'ranks', name: tr('Ausbaustufen', 'City stages'), icon: 'flag' },
    { id: 'challenges', name: tr('Challenges', 'Challenges'), icon: 'medal' },
    { id: 'goal', name: tr('Stadtziel', 'City goal'), icon: 'trophy' },
  ];
  const activeTab = tabs.some((item) => item.id === tab) ? tab : 'quests';
  const rank = getRank(state);
  return `<div class="progression-dialog"><div class="progression-dialog-summary"><span>${icon('sprout')} ${escape(rank.name)}<b>${tr('Stufe', 'Stage')} ${format(rank.id + 1)} / ${format(RANKS.length)}</b></span><span>${icon('sparkles')} ${format(state.progression.xp)} ${tr('EP', 'XP')}</span><span>${icon('medal')} ${format(state.progression.completedChallenges.length)} / ${format(CHALLENGES.length)} ${tr('Abzeichen', 'badges')}</span></div><nav class="progression-tabs" aria-label="${tr('Stadtfortschritt', 'City progression')}">${tabs.map((item) => `<button class="${activeTab === item.id ? 'active' : ''}" data-progress-tab="${item.id}" aria-current="${activeTab === item.id ? 'page' : 'false'}">${icon(item.icon)}<span>${item.name}</span>${item.id === 'goal' && state.progression.victory ? '<b class="progression-tab-dot"></b>' : ''}</button>`).join('')}</nav><div class="progression-tab-content">${activeTab === 'quests' ? questsContent(state) : activeTab === 'ranks' ? ranksContent(state) : activeTab === 'challenges' ? challengesContent(state) : goalContent(state)}</div></div>`;
}
