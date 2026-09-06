import { ZONE_DENSITIES, effectiveZoneDensity, zoneDensityCap } from '../buildings/density';
/** Strict save validation, legacy normalization and JSON round trips. */
import { EASTER_EGG_BUILDING_VARIATION, zoneLotDimensions } from '../buildings/lots';
import type { CityState, Tile, TileKind } from '../domain/types';
import { tr } from '../i18n/index';
import { ECONOMY_STEP_SECONDS } from '../simulation/calendar';
import { KINDS, TOOL_DEFS } from '../simulation/catalog';
import type { BilingualText } from '../simulation/catalog';
import {
  dimensions,
  getFootprint,
  isBuilding,
  isBuildingAnchor,
  isFacility,
  isZone,
} from '../simulation/city-queries';
import { validateCitizenEffects } from '../simulation/disasters';
import { blankStats, recalculate } from '../simulation/economy';
import { createProgression, normalizeProgression } from '../simulation/progression';
import { initializeWeather } from '../simulation/weather-cycle';
import { MAX_ELEVATION, MIN_ELEVATION, TERRAIN_STEP, legacyWaterTerrain } from '../world/terrain';
import { requireBoolean, requireNumber, requireRecord, requireString } from './validation';

const SAVE_FIELD_LABELS: Record<string, BilingualText> = {
  police: ['Polizei', 'Police'],
  fire: ['Feuerwehr', 'Fire protection'],
  health: ['Gesundheit', 'Health'],
  education: ['Bildung', 'Education'],
  population: ['Einwohnerzahl', 'Population'],
  jobs: ['Arbeitsplätze', 'Jobs'],
  happiness: ['Zufriedenheit', 'Happiness'],
  income: ['Einnahmen', 'Income'],
  expenses: ['Ausgaben', 'Expenses'],
  balance: ['Bilanz', 'Balance'],
  powerSupply: ['Stromangebot', 'Power supply'],
  powerDemand: ['Strombedarf', 'Power demand'],
  waterSupply: ['Wasserangebot', 'Water supply'],
  waterDemand: ['Wasserbedarf', 'Water demand'],
  residentialDemand: ['Wohnraumnachfrage', 'Housing demand'],
  commercialDemand: ['Gewerbenachfrage', 'Commercial demand'],
  industrialDemand: ['Industrienachfrage', 'Industrial demand'],
  pollution: ['Umweltbelastung', 'Pollution'],
  traffic: ['Verkehr', 'Traffic'],
  safety: ['Sicherheit', 'Safety'],
  parks: ['Parks', 'Parks'],
  landValue: ['Grundstückswert', 'Land value'],
};

function saveFieldLabel(key: string): string {
  const label = SAVE_FIELD_LABELS[key];
  return label ? tr(...label) : key;
}

function validateProgression(value: unknown, month: number): void {
  const p = requireRecord(value, tr('Stadtfortschritt', 'City progression'));
  requireNumber(p.xp, tr('Erfahrung', 'Experience'), 0, 1000000000);
  requireNumber(p.rank, tr('Stadtrang', 'City rank'), 0, 20, true);
  requireBoolean(p.victory, tr('Kampagnenziel', 'Campaign goal'));
  for (const key of ['completedQuests', 'claimedQuests', 'unlocked', 'completedChallenges']) {
    if (!Array.isArray(p[key]) || p[key].length > 200)
      throw new Error(
        tr('Ungültiger Spielstand: Fortschrittsliste.', 'Invalid saved game: progression list.'),
      );
    for (const id of p[key] as unknown[])
      requireString(id, tr('Fortschrittskennung', 'Progression identifier'), 100);
  }
  const tools = [
    ...Object.keys(TOOL_DEFS),
    'empty',
    'water',
    'rubble',
    'inspect',
    'bulldoze',
    'pan',
    'citizen',
  ];
  if ((p.unlocked as string[]).some((t) => !tools.includes(t)))
    throw new Error(
      tr('Ungültiger Spielstand: Bauwerkzeug.', 'Invalid saved game: construction tool.'),
    );
  const counters = requireRecord(p.counters, tr('Fortschrittszähler', 'Progression counter'));
  if (Object.keys(counters).length > 200)
    throw new Error(
      tr('Ungültiger Spielstand: Fortschrittszähler.', 'Invalid saved game: progression counter.'),
    );
  for (const [key, v] of Object.entries(counters)) {
    requireString(key, tr('Zählername', 'Counter name'), 100);
    requireNumber(v, tr('Fortschrittszähler', 'Progression counter'), -1000000000, 1000000000);
  }
  if (p.activeChallenge !== null) {
    const c = requireRecord(p.activeChallenge, tr('Herausforderung', 'Challenge'));
    requireString(c.id, tr('Herausforderung', 'Challenge'), 100);
    requireNumber(c.startedMonth, tr('Startmonat', 'Start month'), 0, month, true);
    if (!['active', 'completed', 'failed'].includes(c.status as string))
      throw new Error(
        tr('Ungültiger Spielstand: Herausforderung.', 'Invalid saved game: challenge.'),
      );
  }
}

export function deserializeCity(raw: string): CityState {
  if (typeof raw !== 'string' || raw.length > 12000000)
    throw new Error(
      tr('Der Spielstand ist zu groß oder ungültig.', 'The saved game is too large or invalid.'),
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      tr(
        'Der Spielstand enthält kein gültiges JSON.',
        'The saved game does not contain valid JSON.',
      ),
    );
  }
  const data = requireRecord(parsed, tr('Dateiformat', 'File format'));
  const legacy = data.version === 1;
  const size = data.size as number;
  if (
    (!legacy && data.version !== 2) ||
    (legacy && size !== 40) ||
    ![40, 64, 96, 128].includes(size)
  )
    throw new Error(
      tr('Dieser Spielstand wird nicht unterstützt.', 'This saved game is not supported.'),
    );
  requireString(data.name, tr('Stadtname', 'City name'), 64);
  requireNumber(data.seed, tr('Zufallswert', 'Random seed'), 0, 4294967295, true);
  requireNumber(data.money, tr('Stadtkasse', 'Treasury'), -100000, 1000000000);
  requireNumber(data.month, tr('Monat', 'Month'), 0, 1000000, true);
  requireNumber(data.speed, tr('Geschwindigkeit', 'Speed'), 0, 3, true);
  requireNumber(data.tax, tr('Steuern', 'Taxes'), 0, 25);
  requireNumber(data.loan, tr('Kredit', 'Loan'), 0, 50000);
  requireNumber(data.revision, tr('Version', 'Version'), 0, Number.MAX_SAFE_INTEGER, true);
  requireNumber(data.milestone, tr('Meilenstein', 'Milestone'), 0, 5, true);
  const funding = requireRecord(data.funding, tr('Budget', 'Budget'));
  for (const key of ['police', 'fire', 'health', 'education'])
    requireNumber(funding[key], `Budget ${saveFieldLabel(key)}`, 0, 150);
  if (!Array.isArray(data.tiles) || data.tiles.length !== size * size)
    throw new Error(tr('Ungültiger Spielstand: Kartenfelder.', 'Invalid saved game: map tiles.'));
  for (let i = 0; i < data.tiles.length; i++) {
    const t = requireRecord(data.tiles[i], tr('Grundstück', 'Lot'));
    const kind = t.kind as TileKind;
    if (t.x !== i % size || t.z !== Math.floor(i / size) || !KINDS.includes(kind))
      throw new Error(
        tr(
          'Ungültiger Spielstand: Grundstückskoordinaten oder Gebäude.',
          'Invalid saved game: lot coordinates or building.',
        ),
      );
    requireNumber(t.level, tr('Gebäudestufe', 'Building level'), 0, 4, true);
    requireNumber(t.variation, tr('Gebäudevariante', 'Building variation'), 0, 1000000, true);
    requireNumber(t.age, tr('Gebäudealter', 'Building age'), 0, 1000001, true);
    requireNumber(t.fire, tr('Brand', 'Fire'), 0, 100, true);
    for (const key of ['pollution', 'landValue', 'traffic'])
      requireNumber(t[key], saveFieldLabel(key), 0, 100);
    for (const key of ['powered', 'watered', 'connected'])
      requireBoolean(t[key], tr('Versorgungsdaten', 'Utility data'));
    if (legacy) {
      const water = legacyWaterTerrain(t.x as number, t.z as number);
      if (
        (kind === 'water' && !water) ||
        (water && !['water', 'road', 'rail', 'rubble'].includes(kind))
      )
        throw new Error(
          tr('Ungültiger Spielstand: Wasserfläche.', 'Invalid saved game: water area.'),
        );
      Object.assign(t, {
        elevation: water ? -1 : 0,
        hasPipe: kind === 'road',
        hasPowerLine: kind === 'road',
        anchor: isFacility(kind) ? i : -1,
        rotation: 0,
      });
    } else {
      requireNumber(t.elevation, tr('Geländehöhe', 'Terrain height'), MIN_ELEVATION, MAX_ELEVATION);
      if (
        Math.abs(
          (t.elevation as number) / TERRAIN_STEP -
            Math.round((t.elevation as number) / TERRAIN_STEP),
        ) > 0.001
      )
        throw new Error(
          tr('Ungültiger Spielstand: Geländestufen.', 'Invalid saved game: terrain steps.'),
        );
      requireBoolean(t.hasPipe, tr('Wasserrohr', 'Water pipe'));
      requireBoolean(t.hasPowerLine, tr('Stromleitung', 'Power line'));
      requireNumber(
        t.anchor,
        tr('Gebäudegrundfläche', 'Building footprint'),
        -1,
        size * size - 1,
        true,
      );
      requireNumber(t.rotation, tr('Gebäudeausrichtung', 'Building orientation'), 0, 3, true);
      if (
        (kind === 'water' && (t.elevation as number) >= 0) ||
        ((t.elevation as number) < 0 && !['water', 'road', 'rail', 'rubble'].includes(kind))
      )
        throw new Error(
          tr(
            'Ungültiger Spielstand: Bebauung im Wasser.',
            'Invalid saved game: construction in water.',
          ),
        );
    }
    if (t.lotWidth !== undefined || t.lotDepth !== undefined) {
      requireNumber(t.lotWidth, 'Lot width', 1, 3, true);
      requireNumber(t.lotDepth, 'Lot depth', 1, 3, true);
      if (
        !isZone(kind) ||
        (t.anchor as number) < 0 ||
        !['2x1', '1x2', '2x2', '3x2', '2x3'].includes(`${t.lotWidth}x${t.lotDepth}`)
      )
        throw new Error('Invalid saved game: zone lot dimensions.');
    } else if (isZone(kind) && t.anchor !== -1)
      throw new Error('Invalid saved game: zone lot metadata.');
    if (
      t.zoneDensity !== undefined &&
      (!isZone(kind) || !ZONE_DENSITIES.includes(t.zoneDensity as never))
    )
      throw new Error('Invalid saved game: zone density.');
    if (isZone(kind) && (t.level as number) > zoneDensityCap(t as unknown as Tile))
      throw new Error('Invalid saved game: building exceeds zone density.');
    if (t.ruralCommercial !== undefined) {
      requireBoolean(t.ruralCommercial, 'Rural commercial');
      if (
        kind !== 'commercial' ||
        (t.anchor as number) < 0 ||
        !['2x2', '3x2', '2x3'].includes(`${t.lotWidth}x${t.lotDepth}`) ||
        t.variation === EASTER_EGG_BUILDING_VARIATION
      )
        throw new Error('Invalid saved game: rural commercial parcel.');
    }
    if ((!isBuilding(kind) && t.level !== 0) || (isFacility(kind) && t.level !== 1))
      throw new Error(
        tr('Ungültiger Spielstand: Gebäudestufe.', 'Invalid saved game: building level.'),
      );
    if (isFacility(kind) ? (t.anchor as number) < 0 : !isZone(kind) && t.anchor !== -1)
      throw new Error(
        tr('Ungültiger Spielstand: Gebäudeanker.', 'Invalid saved game: building anchor.'),
      );
  }
  const easterEggParts = (data.tiles as Tile[]).filter(
    (t) => t.variation === EASTER_EGG_BUILDING_VARIATION,
  );
  const easterEggAnchors = new Set(easterEggParts.map((t) => t.anchor));
  if (
    easterEggParts.length &&
    (easterEggParts.length !== 6 ||
      easterEggAnchors.size !== 1 ||
      easterEggParts.some(
        (t) =>
          t.kind !== 'commercial' ||
          t.anchor < 0 ||
          t.lotWidth !== (t.rotation % 2 ? 2 : 3) ||
          t.lotDepth !== (t.rotation % 2 ? 3 : 2),
      ))
  )
    throw new Error(
      tr(
        'Ungültiger Spielstand: Easter-Egg-Geschäftsgebäude muss einmalig sein und sechs Felder belegen.',
        'Invalid saved game: Easter Egg business must be unique and occupy six tiles.',
      ),
    );
  const state = data as unknown as CityState;
  if (data.tickProgress === undefined) state.tickProgress = 0;
  else {
    requireNumber(data.tickProgress, tr('Spielzeit', 'Play time'), 0, ECONOMY_STEP_SECONDS);
    if ((data.tickProgress as number) >= ECONOMY_STEP_SECONDS)
      throw new Error(tr('Ungültiger Spielstand: Spielzeit.', 'Invalid saved game: play time.'));
  }
  for (const t of state.tiles) {
    if (t.anchor < 0) continue;
    const anchor = state.tiles[t.anchor];
    if (
      !anchor ||
      anchor.anchor !== t.anchor ||
      anchor.kind !== t.kind ||
      anchor.rotation !== t.rotation ||
      anchor.elevation !== t.elevation
    )
      throw new Error(
        tr(
          'Ungültiger Spielstand: Zusammengehörige Gebäudeteile.',
          'Invalid saved game: linked building parts.',
        ),
      );
    const [w, d] = isZone(t.kind) ? zoneLotDimensions(anchor) : dimensions(t.kind, t.rotation);
    if (
      isZone(t.kind) &&
      (t.lotWidth !== anchor.lotWidth ||
        t.lotDepth !== anchor.lotDepth ||
        t.level !== anchor.level ||
        t.variation !== anchor.variation ||
        t.fire !== anchor.fire ||
        t.ruralCommercial !== anchor.ruralCommercial ||
        effectiveZoneDensity(t) !== effectiveZoneDensity(anchor))
    )
      throw new Error('Invalid saved game: inconsistent zone lot.');
    if (t.x < anchor.x || t.z < anchor.z || t.x >= anchor.x + w || t.z >= anchor.z + d)
      throw new Error(
        tr('Ungültiger Spielstand: Gebäudegrundfläche.', 'Invalid saved game: building footprint.'),
      );
  }
  for (const t of state.tiles) {
    if ((!isFacility(t.kind) && !isZone(t.kind)) || !isBuildingAnchor(state, t)) continue;
    const [w, d] = isZone(t.kind) ? zoneLotDimensions(t) : dimensions(t.kind, t.rotation);
    const count = getFootprint(state, t).length;
    if (isZone(t.kind) ? count !== w * d : count !== 1 && count !== w * d)
      throw new Error(
        tr(
          'Ungültiger Spielstand: Unvollständiges Gebäude.',
          'Invalid saved game: incomplete building.',
        ),
      );
  }
  const stats = requireRecord(data.stats, tr('Statistik', 'Statistics'));
  for (const key of Object.keys(blankStats()))
    requireNumber(
      stats[key],
      tr(`Statistik ${saveFieldLabel(key)}`, `Statistics ${saveFieldLabel(key)}`),
      -1000000000,
      1000000000,
    );
  if (!Array.isArray(data.events) || data.events.length > 40)
    throw new Error(tr('Ungültiger Spielstand: Meldungen.', 'Invalid saved game: events.'));
  for (const item of data.events) {
    const e = requireRecord(item, tr('Meldung', 'Event'));
    requireNumber(e.id, tr('Meldungsnummer', 'Event number'), 0, Number.MAX_SAFE_INTEGER, true);
    requireNumber(e.month, tr('Meldungsmonat', 'Event month'), 0, data.month as number, true);
    requireString(e.title, tr('Meldungstitel', 'Event title'), 180);
    requireString(e.message, tr('Meldungstext', 'Event message'), 2000);
    if (e.titleEn !== undefined)
      requireString(e.titleEn, tr('Englischer Meldungstitel', 'English event title'), 180);
    if (e.messageEn !== undefined)
      requireString(e.messageEn, tr('Englischer Meldungstext', 'English event message'), 2000);
    if (!['info', 'good', 'warning'].includes(e.type as string))
      throw new Error(tr('Ungültiger Meldungstyp.', 'Invalid event type.'));
  }
  if (!Array.isArray(data.history) || data.history.length > 120)
    throw new Error(tr('Ungültiger Spielstand: Verlauf.', 'Invalid saved game: history.'));
  let previousMonth = -1;
  for (const item of data.history) {
    const p = requireRecord(item, tr('Verlauf', 'History'));
    const month = requireNumber(
      p.month,
      tr('Verlaufsmonat', 'History month'),
      0,
      data.month as number,
      true,
    );
    if (month <= previousMonth)
      throw new Error(tr('Ungültige Reihenfolge im Verlauf.', 'Invalid history order.'));
    previousMonth = month;
    requireNumber(p.population, tr('Einwohnerzahl', 'Population'), 0, 2000000, true);
    requireNumber(p.money, tr('Kontostand', 'Account balance'), -100000, 1000000000);
    requireNumber(p.happiness, tr('Zufriedenheit', 'Happiness'), 0, 100);
  }
  if (legacy) {
    state.version = 2;
    state.settings = {
      disastersEnabled: false,
      weather: 'clear',
      dynamicWeather: true,
      dayNightCycle: true,
      timeOfDay: 14,
      buildingLights: true,
    };
    state.progression = createProgression(state);
  } else {
    const settings = requireRecord(data.settings, tr('Einstellungen', 'Settings'));
    requireBoolean(settings.disastersEnabled, tr('Katastrophenmodus', 'Disaster mode'));
    if (settings.buildingLights === undefined) settings.buildingLights = true;
    requireBoolean(settings.buildingLights, tr('Gebäudelichter', 'Building lights'));
    if (settings.dayNightCycle === undefined) settings.dayNightCycle = true;
    if (settings.timeOfDay === undefined) settings.timeOfDay = 14;
    requireBoolean(settings.dayNightCycle, tr('Tag-Nacht-Zyklus', 'Day-night cycle'));
    requireNumber(settings.timeOfDay, tr('Tageszeit', 'Time of day'), 0, 24);
    if ((settings.timeOfDay as number) >= 24)
      throw new Error(tr('Ungültiger Spielstand: Tageszeit.', 'Invalid saved game: time of day.'));
    if (!['clear', 'rain'].includes(settings.weather as string))
      throw new Error(tr('Ungültiger Spielstand: Wetter.', 'Invalid saved game: weather.'));
    if (settings.dynamicWeather !== undefined)
      requireBoolean(settings.dynamicWeather, tr('Dynamisches Wetter', 'Dynamic weather'));
    if (settings.weatherRemaining !== undefined)
      requireNumber(settings.weatherRemaining, tr('Wetterdauer', 'Weather duration'), 0, 3600);
    if (settings.weatherCycle !== undefined)
      requireNumber(
        settings.weatherCycle,
        tr('Wetterwechsel', 'Weather cycle'),
        0,
        1000000000,
        true,
      );
    initializeWeather(state);
    validateProgression(data.progression, data.month as number);
  }
  if (data.citizenEffects === undefined)
    state.citizenEffects = {
      populationLoss: 0,
      happinessPenalty: 0,
      incidents: [],
    };
  else validateCitizenEffects(data.citizenEffects, size, state.month);
  initializeWeather(state);
  const savedRevision = state.revision;
  recalculate(state);
  normalizeProgression(state);
  state.revision = savedRevision;
  return state;
}

export function serializeCity(state: CityState): string {
  const raw = JSON.stringify(state);
  deserializeCity(raw);
  return raw;
}
