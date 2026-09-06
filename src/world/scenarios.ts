import { zoneDensityCap } from '../buildings/density';
import {
  claimEasterEggLot,
  claimZoneLot,
  syncZoneLot,
  isEasterEggLot,
  zoneLotArea,
} from '../buildings/lots';
import { createCity, recalculate, TOOL_DEFS } from '../simulation/city-simulation';
import { shouldAssignRuralCommercial } from './rural';
import { createProgression } from '../simulation/progression';
import type { CityState, Point, TileKind } from '../domain/types';

export const DEFAULT_CITY_SIZE = 96;
export const MAX_NEW_CITY_SIZE = 128;
export const START_CITY_SIZE = 128;
/** Expand directly into the full region so its outer landscape is generated only once. */
export function nextCitySize(size: number): number | null {
  return size < MAX_NEW_CITY_SIZE ? MAX_NEW_CITY_SIZE : null;
}
/** Numeric seeds retain their value; text seeds use stable, platform-independent FNV-1a. */
export function parseCitySeed(input: string | number): number {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.trunc(input) >>> 0 : 2026;
  const value = input.trim();
  if (!value) return 2026;
  if (/^[+-]?\d+$/.test(value)) return Number(BigInt(value) & 0xffffffffn);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
export function starterPoint(size = START_CITY_SIZE): Point {
  return { x: Math.round(size * 0.45 - 0.5), z: Math.round(size * 0.46 - 0.5) };
}
export function generateSmallCity(seed: string | number = 2026, name = 'Meine Stadt'): CityState {
  const city = createCity(parseCitySeed(seed), true, START_CITY_SIZE);
  city.name = name.trim().slice(0, 64) || 'Meine Stadt';
  city.speed = 0;
  // The terrain generator reserves this flat, treeless valley for the first streets.
  const p = starterPoint(city.size);
  for (let z = p.z - 3; z <= p.z + 3; z++)
    for (let x = p.x - 3; x <= p.x + 3; x++)
      Object.assign(city.tiles[z * city.size + x], { kind: 'empty', elevation: 0 });
  recalculate(city);
  city.history = [{ month: 0, population: 0, money: city.money, happiness: city.stats.happiness }];
  return city;
}
/** Authored compact metropolis. All placements are batched before one network recalculation. */
export function generateNewYorkCity(): CityState {
  const city = createCity(6092026, true, DEFAULT_CITY_SIZE),
    size = city.size;
  const at = (x: number, z: number) => city.tiles[z * size + x];
  const set = (x: number, z: number, kind: TileKind) =>
    Object.assign(at(x, z), {
      kind,
      level: 0,
      elevation: kind === 'water' ? -1 : 0,
      anchor: -1,
      age: 24,
      rotation: 0,
    });
  const region = (x: number, z: number, w: number, d: number, kind: TileKind) => {
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) set(x + dx, z + dz, kind);
  };
  const facility = (
    x: number,
    z: number,
    kind: TileKind,
    rotation: 0 | 1 | 2 | 3 = 0,
    variation?: number,
  ) => {
    const fp = TOOL_DEFS[kind]!.footprint!,
      [w, d] = rotation % 2 ? [fp[1], fp[0]] : fp;
    const v = variation ?? (x * 17 + z * 31) % 5;
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) {
        const t = at(x + dx, z + dz);
        if (t.anchor >= 0) throw Error(`Scenario overlap: ${kind}`);
        Object.assign(set(x + dx, z + dz, kind), {
          level: 1,
          anchor: z * size + x,
          rotation,
          variation: v,
          hasPipe: true,
        });
      }
  };
  for (const t of city.tiles)
    Object.assign(t, {
      kind: 'tree',
      elevation: 0,
      level: 0,
      anchor: -1,
      hasPipe: false,
      hasPowerLine: false,
      fire: 0,
    });
  // Fifteen walkable blocks per axis, a planted edge, and the East River waterfront.
  for (let z = 3; z <= 93; z++)
    for (let x = 3; x <= 93; x++)
      set(x, z, (x - 3) % 6 === 0 || (z - 3) % 6 === 0 ? 'road' : 'empty');
  region(94, 0, 2, 96, 'water');
  // Central Park preserves surrounding avenue continuity and a pond with planted banks.
  region(28, 28, 17, 23, 'park');
  for (let z = 31; z < 48; z++)
    for (let x = 30; x < 43; x++) {
      const d = ((x - 36) / 5) ** 2 + ((z - 39) / 7) ** 2;
      if (d < 1) set(x, z, 'water');
      else if ((x + z) % 3 === 0) set(x, z, 'tree');
    }
  // Forty-five clean-energy courts retain ample capacity, opening the outer two columns to countryside.
  for (let bz = 0; bz < 15; bz++)
    for (let bx = 10; bx < 13; bx++) {
      const x = 4 + bx * 6,
        z = 4 + bz * 6;
      region(x, z, 5, 5, 'park');
      facility(x, z, 'solar');
      facility(x, z + 3, 'wind');
      facility(x + 3, z + 3, 'waterpump');
    }
  // Agricultural fringe: small commercial farmsteads among open meadows and low hills.
  // Their road-front parcels stay flat; the surrounding fields have gentle visible relief.
  for (let bz = 0; bz < 15; bz++)
    for (let bx = 13; bx < 15; bx++) {
      const x = 4 + bx * 6,
        z = 4 + bz * 6;
      for (let dz = 0; dz < 5; dz++)
        for (let dx = 0; dx < 5; dx++) {
          const t = set(x + dx, z + dz, (dx + dz + bz * 3) % 11 === 0 ? 'tree' : 'empty');
          if (bz < 5 && dx > 1 && dz > 1) t.elevation = ((dx + dz + bz) % 3) * 0.5;
        }
      if (bz % 3 === 0 && !(bx === 14 && bz === 0)) {
        region(x, z, 3, 2, 'commercial');
        const t = at(x, z);
        for (let dz = 0; dz < 2; dz++)
          for (let dx = 0; dx < 3; dx++) at(x + dx, z + dz).zoneDensity = 'low';
        t.variation = (bz + bx) % 5;
        if (!claimZoneLot(city, t, [3, 2])) throw Error('Farm parcel claim failed');
        t.level = 1;
        syncZoneLot(city, t);
      }
    }
  // Broken woodland edges leave sunny meadow openings around the whole map.
  for (const t of city.tiles)
    if ((t.x < 3 || t.z < 3 || t.z > 93) && t.kind === 'tree' && (t.x * 7 + t.z * 11) % 5 < 3) {
      t.kind = 'empty';
      t.elevation = (t.x + t.z) % 9 === 0 ? 0.5 : 0;
    }
  // Service courts repeat across the residential boroughs, leaving readable green courtyards.
  for (const bz of [1, 4, 8, 11, 14])
    for (const bx of [0, 3, 6, 9]) {
      const x = 4 + bx * 6,
        z = 4 + bz * 6;
      if (x >= 28 && x <= 44 && z >= 28 && z <= 50) continue;
      region(x, z, 5, 5, 'park');
      facility(x, z, 'hospital');
      facility(x + 3, z, 'police');
      facility(x, z + 3, 'fire');
      const sx = bx === 9 ? x - 6 : x + 6;
      if (at(sx, z).kind !== 'empty') continue;
      region(sx, z, 5, 5, 'park');
      facility(sx, z, 'school');
    }
  // Airport occupies two joined blocks south of the park; river quays face east.
  region(46, 76, 11, 11, 'park');
  facility(46, 76, 'airport');
  region(10, 76, 11, 5, 'park');
  facility(10, 76, 'stadium');
  region(46, 52, 5, 5, 'park');
  facility(46, 52, 'university');
  // The medium business landmark faces north: its street, then Central Park.
  // A landscaped block and broad park foreground preserve both diagonal facade views.
  region(34, 52, 5, 5, 'park');
  region(34, 52, 3, 2, 'commercial');
  for (let dz = 0; dz < 2; dz++)
    for (let dx = 0; dx < 3; dx++) at(34 + dx, 52 + dz).zoneDensity = 'medium';
  const easterEgg = at(34, 52);
  if (!claimEasterEggLot(city, easterEgg, true))
    throw Error('EASTER_EGG park-front parcel could not be claimed');
  easterEgg.level = 2;
  syncZoneLot(city, easterEgg);
  for (const z of [70, 82]) {
    // Replace only the final campus block, including its complete original facilities.
    for (let dz = 0; dz < 5; dz++)
      for (let dx = 0; dx < 5; dx++) Object.assign(at(88 + dx, z + dz), { anchor: -1 });
    region(88, z, 6, 5, 'park');
    facility(91, z, 'seaport', 3);
  }
  for (const [x, z] of [
    [52, 64],
    [58, 70],
    [28, 82],
  ])
    if (at(x, z).kind === 'empty') {
      region(x, z, 5, 5, 'park');
      facility(x, z, 'recycling');
    }
  // Inner courtyards keep every single-tile home within the network frontage radius.
  for (let z = 6; z < 93; z += 6)
    for (let x = 6; x < 93; x += 6) if (at(x, z).kind === 'empty') set(x, z, 'park');
  // Shared lot metadata makes these genuine parcels rather than overlaid visual towers.
  let parcel = 0;
  for (let z = 4; z < 93; z++)
    for (let x = 4; x < 93; x++) {
      if (at(x, z).kind !== 'empty' || x >= 82) continue;
      const blockX = Math.floor((x - 4) / 6),
        blockZ = Math.floor((z - 4) / 6),
        industrial = x >= 46 && z >= 64;
      // Street-aligned districts make the skyline legible from the overview:
      // Midtown around Central Park, an apartment belt, then low outer boroughs.
      // The industrial waterfront steps down from its northern employment hub.
      const zoneDensity = industrial
        ? blockZ === 10
          ? 'high'
          : blockZ <= 12
            ? 'medium'
            : 'low'
        : blockX >= 3 && blockX <= 8 && blockZ >= 3 && blockZ <= 9
          ? 'high'
          : blockX >= 2 && blockX <= 9 && blockZ >= 2 && blockZ <= 11
            ? 'medium'
            : 'low';
      const kind: TileKind = industrial
        ? 'industrial'
        : (blockX + blockZ * 2) % 5 === 0 || (blockX === 8 && blockZ >= 4 && blockZ <= 8)
          ? 'commercial'
          : 'residential';
      const variant = parcel++ % 5,
        wanted = variant === 4 ? [3, 2] : variant === 3 ? [2, 2] : variant === 2 ? [2, 1] : [1, 1];
      let [w, d] = wanted;
      if (
        !Array.from({ length: w * d }, (_, i) => at(x + (i % w), z + Math.floor(i / w))).every(
          (t) => t?.kind === 'empty',
        )
      )
        [w, d] = [1, 1];
      for (let dz = 0; dz < d; dz++)
        for (let dx = 0; dx < w; dx++)
          Object.assign(set(x + dx, z + dz, kind), { variation: variant, zoneDensity });
      const t = at(x, z);
      if (w * d > 1 && !claimZoneLot(city, t, [w, d])) throw Error('Scenario parcel claim failed');
      t.level = zoneDensityCap(t);
      syncZoneLot(city, t);
    }
  for (const t of city.tiles)
    if (
      t.kind === 'commercial' &&
      t.anchor === t.z * size + t.x &&
      [4, 6].includes(zoneLotArea(t)) &&
      !isEasterEggLot(t)
    ) {
      t.ruralCommercial = shouldAssignRuralCommercial(city, t);
      syncZoneLot(city, t);
    }
  for (const t of city.tiles)
    if (t.kind === 'road') {
      t.hasPowerLine = true;
      t.hasPipe = true;
    }
  city.name = 'New York';
  city.money = 20_000_000;
  city.month = 0;
  city.tickProgress = 0;
  city.speed = 0;
  city.tax = 9;
  city.funding = { police: 120, fire: 120, health: 120, education: 120 };
  city.settings = {
    disastersEnabled: false,
    weather: 'clear',
    dynamicWeather: true,
    weatherRemaining: 240,
    weatherCycle: 0,
    dayNightCycle: true,
    timeOfDay: 14,
    buildingLights: true,
  };
  recalculate(city);
  city.progression = createProgression();
  city.milestone = 0;
  city.events = [
    {
      id: 1,
      month: 0,
      title: 'Willkommen in New York',
      message:
        'Übernimm eine vorbereitete Stadt mit Hochhauskern am Central Park, mittleren Wohnvierteln, niedrigen Außenbezirken und Hafen. Die Simulation startet pausiert.',
      titleEn: 'Welcome to New York',
      messageEn:
        'Take over a prepared city with a high-rise core around Central Park, midrise neighborhoods, low outer boroughs and a harbor. The simulation starts paused.',
      type: 'info',
    },
  ];
  city.history = [
    {
      month: 0,
      population: city.stats.population,
      money: city.money,
      happiness: city.stats.happiness,
    },
  ];
  return city;
}
