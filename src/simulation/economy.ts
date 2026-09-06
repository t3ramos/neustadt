/** Derived city statistics, service influence, operating costs and credit commands. */
import { zoneLotArea } from '../buildings/lots';
import type { BuildResult, CityState, Stats, TileKind } from '../domain/types';
import { formatNumber, tr } from '../i18n/index';
import { COM_JOBS, IND_JOBS, POP, TOOL_DEFS } from './catalog';
import { clamp, isBuilding, isBuildingAnchor } from './city-queries';
import { addEvent, result } from './events';
import { stamp, updateUtilityNetworks } from './networks';

export function blankStats(): Stats {
  return {
    population: 0,
    jobs: 0,
    happiness: 70,
    income: 0,
    expenses: 0,
    balance: 0,
    powerSupply: 0,
    powerDemand: 0,
    waterSupply: 0,
    waterDemand: 0,
    residentialDemand: 80,
    commercialDemand: 15,
    industrialDemand: 55,
    pollution: 0,
    traffic: 0,
    education: 25,
    health: 35,
    safety: 35,
    parks: 0,
  };
}

/** Every influence field is stamped locally. No all-tiles × all-buildings loops. */
export function recalculate(state: CityState): void {
  state.tax = clamp(state.tax, 0, 25);
  for (const key of Object.keys(state.funding) as (keyof CityState['funding'])[])
    state.funding[key] = clamp(state.funding[key], 0, 150);
  const n = state.tiles.length;
  const stats = blankStats();
  const anchors = state.tiles.filter((t) => isBuildingAnchor(state, t));
  const buildings = anchors.filter((t) => isBuilding(t.kind));
  const { commercialJobs, industrialJobs } = updateUtilityNetworks(
    state,
    anchors,
    buildings,
    stats,
  );
  const green = new Float32Array(n);
  const pollutionField = new Float32Array(n);
  const movement = new Float32Array(n);
  const railField = new Float32Array(n);
  const policeField = new Float32Array(n);
  const fireField = new Float32Array(n);
  const hospitalField = new Float32Array(n);
  const schoolField = new Float32Array(n);
  const coast = new Float32Array(n);
  const functional = (kind: TileKind) =>
    buildings.filter(
      (t) => t.kind === kind && t.connected && t.powered && t.watered && t.fire === 0,
    );
  const police = functional('police');
  const fire = functional('fire');
  const hospitals = functional('hospital');
  const schools = functional('school');
  const universities = functional('university');
  const recycling = functional('recycling');
  for (const t of state.tiles) {
    if (t.kind === 'tree' || t.kind === 'park' || t.kind === 'beach')
      stamp(state, green, t, 5, t.kind === 'tree' ? 1.6 : 7);
    if (t.kind === 'rail') stamp(state, railField, t, 5, 1, true);
    if (t.elevation < 0) stamp(state, coast, t, 3, 10, true);
  }
  for (const t of buildings) {
    if ((t.kind === 'industrial' && t.level > 0) || t.kind === 'power' || t.kind === 'airport')
      stamp(
        state,
        pollutionField,
        t,
        t.kind === 'power' ? 9 : 6,
        t.kind === 'power' ? 55 : t.kind === 'airport' ? 38 : 20 + t.level * 9,
      );
    stamp(
      state,
      movement,
      t,
      3,
      t.kind === 'residential'
        ? POP[t.level] * 0.13
        : t.kind === 'commercial'
          ? COM_JOBS[t.level] * 0.18
          : t.kind === 'industrial'
            ? IND_JOBS[t.level] * 0.2
            : 2,
    );
  }
  for (const t of police) stamp(state, policeField, t, 18, 1, true);
  for (const t of fire) stamp(state, fireField, t, 18, 1, true);
  for (const t of hospitals) stamp(state, hospitalField, t, 20, 1, true);
  for (const t of schools) stamp(state, schoolField, t, 19, 1, true);
  for (const t of universities) stamp(state, schoolField, t, 30, 1.25, true);
  for (const t of recycling) stamp(state, green, t, 14, 24);
  const stadiums = functional('stadium').length;
  const airports = functional('airport').length;
  const seaports = functional('seaport').length;
  stats.jobs =
    commercialJobs +
    industrialJobs +
    stadiums * 120 +
    airports * 180 +
    seaports * 120 +
    police.length * 12 +
    fire.length * 12 +
    hospitals.length * 35 +
    schools.length * 20 +
    universities.length * 160 +
    recycling.length * 25;
  let peopleWeight = 0;
  let edu = 0;
  let health = 0;
  let safety = 0;
  let pollution = 0;
  let traffic = 0;
  let utilityCoverage = 0;
  let parkAccess = 0;
  for (let i = 0; i < n; i++) {
    const t = state.tiles[i];
    t.pollution = Math.round(clamp(pollutionField[i] - green[i]));
    t.traffic = Math.round(
      clamp(movement[i] * (railField[i] > 0 ? 0.6 : 1) * (t.kind === 'road' ? 1.4 : 0.8)),
    );
    t.landValue = Math.round(
      clamp(
        58 +
          green[i] * 1.2 +
          coast[i] +
          policeField[i] * 10 +
          schoolField[i] * 10 -
          t.pollution * 0.6 -
          t.traffic * 0.12,
      ),
    );
    if (t.kind === 'residential' && t.level > 0 && isBuildingAnchor(state, t)) {
      const weight = POP[t.level] * zoneLotArea(t);
      peopleWeight += weight;
      edu += (25 + (schoolField[i] * 65 * state.funding.education) / 100) * weight;
      health +=
        (35 + (hospitalField[i] * 65 * state.funding.health) / 100 - t.pollution * 0.15) * weight;
      safety += (35 + (policeField[i] * 65 * state.funding.police) / 100) * weight;
      pollution += t.pollution * weight;
      traffic += t.traffic * weight;
      utilityCoverage += (t.powered && t.watered && t.connected ? 1 : 0) * weight;
      parkAccess += clamp(green[i] / 20, 0, 1) * weight;
    }
  }
  stats.education = Math.round(clamp(peopleWeight ? edu / peopleWeight : 25));
  stats.health = Math.round(clamp(peopleWeight ? health / peopleWeight : 35));
  stats.safety = Math.round(clamp(peopleWeight ? safety / peopleWeight : 35));
  stats.pollution = Math.round(peopleWeight ? pollution / peopleWeight : 0);
  stats.traffic = Math.round(peopleWeight ? traffic / peopleWeight : 0);
  stats.population = Math.max(0, stats.population - state.citizenEffects.populationLoss);
  const jobRatio = stats.jobs / Math.max(50, stats.population * 0.48);
  stats.happiness = Math.round(
    clamp(
      50 +
        Math.min(1, jobRatio) * 16 +
        (stats.education + stats.health + stats.safety - 135) * 0.1 +
        (peopleWeight ? utilityCoverage / peopleWeight : 1) * 12 +
        (peopleWeight ? parkAccess / peopleWeight : 0) * 8 -
        (state.tax - 9) * 2.4 -
        stats.pollution * 0.25 -
        Math.max(0, stats.traffic - 55) * 0.15 -
        (peopleWeight && utilityCoverage / peopleWeight < 0.75 ? 20 : 0) -
        state.citizenEffects.happinessPenalty,
    ),
  );
  stats.residentialDemand = Math.round(
    clamp(
      45 + (jobRatio - 1) * 30 + (stats.happiness - 65) * 0.9 - (state.tax - 9) * 2 + stadiums * 10,
      -100,
      100,
    ),
  );
  if (stats.population >= 120)
    stats.residentialDemand = Math.min(
      stats.residentialDemand,
      Math.round((jobRatio - 0.55) * 120),
    );
  stats.commercialDemand = Math.round(
    clamp(
      40 +
        ((stats.population * 0.18 - commercialJobs) / Math.max(60, stats.population * 0.18)) * 60 +
        (stats.education - 50) * 0.35 -
        (state.tax - 9) * 3 +
        airports * 18,
      -100,
      100,
    ),
  );
  stats.industrialDemand = Math.round(
    clamp(
      40 +
        ((stats.population * 0.34 - industrialJobs) / Math.max(90, stats.population * 0.34)) * 60 -
        (state.tax - 9) * 3 +
        seaports * 18,
      -100,
      100,
    ),
  );
  if (stats.population === 0) {
    stats.residentialDemand = 80;
    stats.commercialDemand = 15;
    stats.industrialDemand = 55;
  }
  stats.income = Math.round(
    stats.population * state.tax * 0.14 +
      (commercialJobs + industrialJobs) * state.tax * 0.04 +
      stadiums * 120 +
      airports * 180 +
      seaports * 120,
  );
  let upkeep = 0;
  for (const t of anchors) {
    let cost = TOOL_DEFS[t.kind]?.upkeep ?? 0;
    if (t.kind === 'police') cost *= state.funding.police / 100;
    if (t.kind === 'fire') cost *= state.funding.fire / 100;
    if (t.kind === 'hospital') cost *= state.funding.health / 100;
    if (t.kind === 'school' || t.kind === 'university') cost *= state.funding.education / 100;
    upkeep += cost;
  }
  for (const t of state.tiles) upkeep += (t.hasPipe ? 0.08 : 0) + (t.hasPowerLine ? 0.08 : 0);
  stats.expenses = Math.ceil(upkeep + state.loan * 0.005);
  stats.balance = stats.income - stats.expenses;
  state.stats = stats;
  state.revision++;
}

export function takeLoan(state: CityState): BuildResult {
  if (state.loan >= 50000)
    return result(
      false,
      tr(
        'Das Kreditlimit von 50.000 € ist erreicht.',
        'The €50,000 credit limit has been reached.',
      ),
    );
  const amount = Math.min(10000, 50000 - state.loan);
  state.loan += amount;
  state.money = Math.min(1000000000, state.money + amount);
  state.progression.counters.loansTaken = (state.progression.counters.loansTaken ?? 0) + 1;
  recalculate(state);
  addEvent(
    state,
    ['Kredit ausgezahlt', 'Loan paid out'],
    [
      `${amount.toLocaleString('de-DE')} € wurden ausgezahlt. Zinsen sind in der laufenden Bilanz enthalten.`,
      `€${amount.toLocaleString('en-US')} paid out. Interest is included in the running balance.`,
    ],
  );
  return result(
    true,
    tr(`${formatNumber(amount)} € Kredit aufgenommen.`, `Borrowed €${formatNumber(amount)}.`),
    -amount,
    1,
  );
}

export function repayLoan(state: CityState): BuildResult {
  if (state.loan <= 0)
    return result(
      false,
      tr('Die Stadt hat keine offenen Kredite.', 'The city has no outstanding loans.'),
    );
  const amount = Math.min(10000, state.loan);
  if (state.money < amount)
    return result(
      false,
      tr('Nicht genügend Geld für die Rückzahlung.', 'Not enough money to repay the loan.'),
      amount,
    );
  state.loan -= amount;
  state.money -= amount;
  recalculate(state);
  return result(
    true,
    tr(`${formatNumber(amount)} € Kredit zurückgezahlt.`, `Repaid €${formatNumber(amount)}.`),
    amount,
    1,
  );
}
