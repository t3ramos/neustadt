/** Fire progression, disaster commands and validated resident consequences. */
import { zoneLotArea } from '../buildings/lots';
import type { BuildResult, CitizenIncident, CityState, DisasterKind, Tile } from '../domain/types';
import { tr } from '../i18n/index';
import { requireBoolean, requireNumber, requireRecord } from '../persistence/validation';
import { POP } from './catalog';
import type { BilingualText } from './catalog';
import {
  clamp,
  getFootprint,
  hasStructure,
  isBuildingAnchor,
  random,
  rootTile,
  tileAt,
} from './city-queries';
import { recalculate } from './economy';
import { addEvent, result } from './events';
import { updateProgression } from './progression';
import { OFFSETS } from './networks';
import { destroyBuilding } from './tile-operations';
import { chooseWeather } from './weather-cycle';

function fireProtection(state: CityState, tile: Tile, stations: Tile[]): number {
  return stations.reduce(
    (best, t) =>
      Math.max(
        best,
        (clamp(1 - (Math.abs(t.x - tile.x) + Math.abs(t.z - tile.z)) / 18, 0, 1) *
          state.funding.fire) /
          100,
      ),
    0,
  );
}

export function triggerDisaster(state: CityState, kind: DisasterKind): BuildResult {
  if (!state.settings.disastersEnabled)
    return result(
      false,
      tr(
        'Aktiviere zuerst den Katastrophenmodus in den Einstellungen.',
        'Enable disaster mode in settings first.',
      ),
    );
  if (!['fire', 'earthquake', 'storm'].includes(kind))
    return result(
      false,
      tr('Diese Katastrophe ist nicht verfügbar.', 'This disaster is not available.'),
    );
  const candidates = state.tiles.filter((t) => hasStructure(t) && isBuildingAnchor(state, t));
  if (!candidates.length) {
    addEvent(
      state,
      ['Keine Schäden', 'No damage'],
      [
        'Im betroffenen Gebiet stehen noch keine Gebäude.',
        'There are no buildings in the affected area yet.',
      ],
    );
    state.revision++;
    return result(false, tr('Es gibt noch keine Gebäude.', 'There are no buildings yet.'));
  }
  let target =
    candidates[
      Math.floor(random(state.seed, state.month, state.revision, 451) * candidates.length)
    ];
  if (kind === 'fire') {
    for (const p of getFootprint(state, target)) tileAt(state, p.x, p.z)!.fire = 6;
    addEvent(
      state,
      ['Brand in der Stadt', 'Fire in the city'],
      [
        `Ein Gebäude bei ${target.x}, ${target.z} brennt. Eine versorgte Feuerwache begrenzt die Schäden.`,
        `A building at ${target.x}, ${target.z} is on fire. A supplied fire station can limit the damage.`,
      ],
      'warning',
    );
  } else {
    let count = 0;
    const radius = kind === 'storm' ? 8 : 6;
    const victims = candidates.filter(
      (t) =>
        Math.abs(t.x - target.x) + Math.abs(t.z - target.z) <= radius &&
        (t === target ||
          random(state.seed, t.x, t.z, state.month + 1) < (kind === 'storm' ? 0.25 : 0.65)),
    );
    for (const t of victims) {
      destroyBuilding(state, t);
      count++;
    }
    let broken = 0;
    for (const t of state.tiles) {
      if (Math.abs(t.x - target.x) + Math.abs(t.z - target.z) > radius) continue;
      if (t.hasPowerLine || t.hasPipe) {
        if (kind === 'storm') t.hasPowerLine = false;
        else {
          t.hasPowerLine = false;
          t.hasPipe = false;
        }
        broken++;
      }
      if (
        kind === 'earthquake' &&
        ['road', 'rail'].includes(t.kind) &&
        random(state.seed, t.x, t.z, state.month + 3) < 0.45
      ) {
        t.kind = 'rubble';
        t.level = 0;
      }
    }
    if (kind === 'storm') chooseWeather(state, 'rain', state.settings.dynamicWeather !== false);
    const label: BilingualText =
      kind === 'earthquake' ? ['Erdbeben', 'Earthquake'] : ['Schwerer Sturm', 'Severe storm'];
    addEvent(
      state,
      label,
      [
        `${count} Gebäude beschädigt, ${broken} Leitungsfelder unterbrochen. Räume Trümmer, repariere die Netze und stelle die Versorgung wieder her.`,
        `${count} buildings damaged, ${broken} utility tiles disrupted. Clear rubble, repair the networks and restore service.`,
      ],
      'warning',
    );
  }
  state.progression.counters.disastersTriggered =
    (state.progression.counters.disastersTriggered ?? 0) + 1;
  recalculate(state);
  updateProgression(state);
  return result(true, tr('Katastrophe ausgelöst.', 'Disaster triggered.'), 0, 1);
}

function validateCitizenIncident(
  value: unknown,
  size: number,
): Omit<CitizenIncident, 'id' | 'month'> {
  const data = requireRecord(value, tr('Einwohnerereignis', 'Resident incident'));
  requireNumber(data.x, tr('Ereignisposition X', 'Incident position X'), -8, size + 8);
  requireNumber(data.z, tr('Ereignisposition Z', 'Incident position Z'), -8, size + 8);
  requireNumber(data.y, tr('Ereignishöhe', 'Incident height'), -16, 128);
  for (const axis of ['nx', 'ny', 'nz'])
    requireNumber(data[axis], tr('Oberflächennormale', 'Surface normal'), -1, 1);
  if (Math.hypot(data.nx as number, data.ny as number, data.nz as number) < 0.001)
    throw new Error(
      tr('Ungültiger Spielstand: Oberflächennormale.', 'Invalid saved game: surface normal.'),
    );
  requireBoolean(data.witnessed, tr('Zeugenstatus', 'Witness status'));
  if (!['impact', 'abduction'].includes(data.kind as string))
    throw new Error(
      tr('Ungültiger Spielstand: Einwohnerereignis.', 'Invalid saved game: resident incident.'),
    );
  return data as unknown as Omit<CitizenIncident, 'id' | 'month'>;
}

export function validateCitizenEffects(value: unknown, size: number, month: number): void {
  const effects = requireRecord(value, tr('Einwohnerereignisse', 'Resident incidents'));
  requireNumber(
    effects.populationLoss,
    tr('Einwohnerverluste', 'Residents lost'),
    0,
    2000000,
    true,
  );
  requireNumber(effects.happinessPenalty, tr('Stimmungseinfluss', 'Happiness impact'), 0, 30, true);
  if (!Array.isArray(effects.incidents) || effects.incidents.length > 64)
    throw new Error(
      tr(
        'Ungültiger Spielstand: Einwohnerereignisliste.',
        'Invalid saved game: resident incident list.',
      ),
    );
  let previousId = 0;
  let previousMonth = 0;
  for (const value of effects.incidents) {
    validateCitizenIncident(value, size);
    const data = requireRecord(value, tr('Einwohnerereignis', 'Resident incident'));
    const id = requireNumber(
      data.id,
      tr('Ereignisnummer', 'Incident number'),
      1,
      Number.MAX_SAFE_INTEGER,
      true,
    );
    const eventMonth = requireNumber(
      data.month,
      tr('Ereignismonat', 'Incident month'),
      0,
      month,
      true,
    );
    if (id <= previousId || eventMonth < previousMonth)
      throw new Error(
        tr('Ungültiger Spielstand: Ereignisreihenfolge.', 'Invalid saved game: incident order.'),
      );
    previousId = id;
    previousMonth = eventMonth;
  }
}

/** Effects are counters independent of tile capacity, so one incident removes exactly one resident. */
export function applyCitizenIncident(
  state: CityState,
  incident: Omit<CitizenIncident, 'id' | 'month'>,
): BuildResult {
  try {
    validateCitizenIncident(incident, state.size);
  } catch {
    return result(false, tr('Ungültiges Einwohnerereignis.', 'Invalid resident incident.'));
  }
  const basePopulation = state.tiles.reduce(
    (sum, t) =>
      sum +
      (t.kind === 'residential' && isBuildingAnchor(state, t) ? POP[t.level] * zoneLotArea(t) : 0),
    0,
  );
  const effects = state.citizenEffects;
  const nextId = (state.citizenEffects.incidents.at(-1)?.id ?? 0) + 1;
  if (!Number.isSafeInteger(nextId))
    return result(
      false,
      tr('Der Ereigniszähler ist ausgeschöpft.', 'The incident counter has reached its limit.'),
    );
  if (basePopulation - effects.populationLoss <= 0)
    return result(false, tr('Die Stadt hat keine Einwohner.', 'The city has no residents.'));
  effects.populationLoss = Math.min(basePopulation, effects.populationLoss + 1);
  if (incident.witnessed) effects.happinessPenalty = Math.min(30, effects.happinessPenalty + 2);
  const normalLength = Math.hypot(incident.nx, incident.ny, incident.nz);
  effects.incidents.push({
    id: nextId,
    month: state.month,
    x: incident.x,
    y: incident.y,
    z: incident.z,
    nx: incident.nx / normalLength,
    ny: incident.ny / normalLength,
    nz: incident.nz / normalLength,
    witnessed: incident.witnessed,
    kind: incident.kind,
  });
  effects.incidents = effects.incidents.slice(-64);
  recalculate(state);
  updateProgression(state);
  return result(
    true,
    incident.witnessed
      ? tr(
          'Einwohner verloren. Die Zeugen sind beunruhigt.',
          'A resident was lost. Witnesses are distressed.',
        )
      : tr('Ein Einwohner ist verschwunden.', 'A resident has disappeared.'),
    0,
    1,
  );
}

/** Advances one burning anchor in tile order; spreading is applied after the growth pass. */
export function advanceBuildingFire(
  state: CityState,
  tile: Tile,
  fireStations: Tile[],
  fireSpread: Tile[],
): boolean {
  const protection = fireProtection(state, tile, fireStations);
  tile.fire = Math.max(0, tile.fire - (protection > 0.15 ? Math.ceil(1 + protection * 4) : 1));
  for (const p of getFootprint(state, tile)) tileAt(state, p.x, p.z)!.fire = tile.fire;
  if (tile.fire === 0) {
    if (protection < 0.3 && random(state.seed, state.month, tile.x, tile.z) < 0.8) {
      destroyBuilding(state, tile);
      return true;
    }
  } else if (protection < 0.2 && random(state.seed, state.month, tile.x, tile.z + 100) < 0.25) {
    for (const [dx, dz] of OFFSETS) {
      const t = tileAt(state, tile.x + dx, tile.z + dz);
      if (t && hasStructure(t) && t.fire === 0) fireSpread.push(rootTile(state, t));
    }
  }
  return false;
}
