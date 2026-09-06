import { zoneDensityCap } from '../buildings/density';
/** Monthly growth, accounting, progression and history orchestration. */
import { tryEarlyEasterEggLot, claimZoneLot, syncZoneLot, zoneLotArea } from '../buildings/lots';
import type { CityState, Tile } from '../domain/types';
import { shouldAssignRuralCommercial } from '../world/rural';
import { perMonth } from './calendar';
import { clamp, getFootprint, isBuildingAnchor, isZone, random, tileAt } from './city-queries';
import { advanceBuildingFire } from './disasters';
import { recalculate } from './economy';
import { addEvent } from './events';
import { getRank, updateProgression } from './progression';

export function tick(state: CityState): void {
  state.month++;
  recalculate(state);
  const oldPopulation = state.stats.population;
  const fireSpread: Tile[] = [];
  let destroyed = 0;
  const growthCap = [2, 3, 4][getRank(state).id] ?? 2;
  const fireStations = state.tiles.filter(
    (t) =>
      t.kind === 'fire' &&
      isBuildingAnchor(state, t) &&
      t.fire === 0 &&
      t.connected &&
      t.powered &&
      t.watered,
  );
  for (const tile of state.tiles) {
    if (!isBuildingAnchor(state, tile)) continue;
    if (tile.fire > 0) {
      if (advanceBuildingFire(state, tile, fireStations, fireSpread)) destroyed++;
      continue;
    }
    if (!isZone(tile.kind)) continue;
    tile.age++;
    const demand =
      tile.kind === 'residential'
        ? state.stats.residentialDemand
        : tile.kind === 'commercial'
          ? state.stats.commercialDemand
          : state.stats.industrialDemand;
    const viable = tile.connected && tile.powered && tile.watered;
    const roll = random(state.seed, state.month, tile.x, tile.z);
    if (
      (!viable || demand < -35 || state.stats.happiness < 25) &&
      tile.level > 0 &&
      tile.age >= 3 &&
      roll < (!viable ? 0.32 : 0.14)
    ) {
      tile.level--;
      tile.age = 0;
    } else if (
      viable &&
      demand > 0 &&
      state.stats.happiness >= 35 &&
      tile.level < Math.min(growthCap, zoneDensityCap(tile)) &&
      tile.age >= 2
    ) {
      const growthChance =
        (tile.level === 0 ? 0.32 : 0.045) +
        demand * 0.0013 +
        (tile.kind === 'residential' ? tile.landValue * 0.00045 : 0);
      if (roll < growthChance) {
        if (tile.level === 0) {
          const landmark = tryEarlyEasterEggLot(state, tile);
          const claimed = !landmark && claimZoneLot(state, tile);
          if (claimed && tile.kind === 'commercial' && [4, 6].includes(zoneLotArea(tile)))
            tile.ruralCommercial = shouldAssignRuralCommercial(state, tile);
        }
        tile.level++;
        tile.age = 0;
      }
    }
    syncZoneLot(state, tile);
  }
  for (const t of fireSpread)
    for (const p of getFootprint(state, t)) tileAt(state, p.x, p.z)!.fire = 4;
  if (destroyed)
    addEvent(
      state,
      ['Brandschäden', 'Fire damage'],
      [
        `${destroyed} Gebäude wurden zerstört. Räume die Grundstücke und baue die Feuerwehr aus.`,
        `${destroyed} buildings were destroyed. Clear the lots and expand fire protection.`,
      ],
      'warning',
    );
  recalculate(state);
  state.money = clamp(state.money + state.stats.balance, -100000, 1000000000);
  const milestones = [2500, 5000, 10000, 20000, 40000];
  while (
    state.milestone < milestones.length &&
    state.stats.population >= milestones[state.milestone]
  ) {
    const population = milestones[state.milestone];
    const reward = [5000, 10000, 15000, 25000, 40000][state.milestone];
    state.money = Math.min(1000000000, state.money + reward);
    state.milestone++;
    addEvent(
      state,
      ['Eine Stadt wächst', 'A growing city'],
      [
        `${population.toLocaleString('de-DE')} Einwohner! Das Land fördert deine Stadt mit ${reward.toLocaleString('de-DE')} €.`,
        `${population.toLocaleString('en-US')} residents! Your city receives a grant of €${reward.toLocaleString('en-US')}.`,
      ],
      'good',
    );
  }
  if (state.month % 12 === 0)
    addEvent(
      state,
      ['Stadtbilanz', 'City balance'],
      [
        `${state.stats.population.toLocaleString('de-DE')} Einwohner · ${state.stats.happiness} % Zufriedenheit · ${state.stats.balance >= 0 ? '+' : ''}${perMonth(state.stats.balance).toLocaleString('de-DE')} € pro Spielmonat.`,
        `${state.stats.population.toLocaleString('en-US')} residents · ${state.stats.happiness}% happiness · ${state.stats.balance >= 0 ? '+' : ''}€${perMonth(state.stats.balance).toLocaleString('en-US')} per calendar month.`,
      ],
      state.stats.balance >= 0 ? 'good' : 'warning',
    );
  if (state.money < 0 && state.month % 3 === 0)
    addEvent(
      state,
      ['Die Stadtkasse ist im Minus', 'The treasury is overdrawn'],
      [
        'Erhöhe Steuern, reduziere Ausgaben oder nimm einen Kredit auf.',
        'Raise taxes, reduce spending or take out a loan.',
      ],
      'warning',
    );
  if (oldPopulation > 100 && state.stats.population < oldPopulation * 0.9 && state.month % 3 === 0)
    addEvent(
      state,
      ['Einwohner ziehen fort', 'Residents are moving away'],
      [
        'Prüfe Straßenanschluss, Stromleitungen, Wasserrohre und Arbeitsplätze.',
        'Check road access, power lines, water pipes and jobs.',
      ],
      'warning',
    );
  updateProgression(state, { monthly: true });
  state.history.push({
    month: state.month,
    population: state.stats.population,
    money: state.money,
    happiness: state.stats.happiness,
  });
  state.history = state.history.slice(-120);
  state.revision++;
}
