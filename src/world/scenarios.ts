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
import type { CityState, Point, TileKind, ZoneDensity } from '../domain/types';

export const DEFAULT_CITY_SIZE = 128;
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
/** Authored metropolis with a civic landscape at its center and compact outer infrastructure. */
export function generateNewYorkCity(): CityState {
  const city = createCity(6092026, true, DEFAULT_CITY_SIZE),
    size = city.size;
  const at = (x: number, z: number) => city.tiles[z * size + x];
  const set = (x: number, z: number, kind: TileKind) => {
    const t = at(x, z);
    Object.assign(t, {
      kind,
      level: 0,
      elevation: kind === 'water' ? -1 : 0,
      anchor: -1,
      age: 24,
      rotation: 0,
      fire: 0,
      hasPipe: false,
      hasPowerLine: false,
    });
    delete t.lotWidth;
    delete t.lotDepth;
    delete t.zoneDensity;
    delete t.ruralCommercial;
    return t;
  };
  const region = (x: number, z: number, w: number, d: number, kind: TileKind) => {
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) set(x + dx, z + dz, kind);
  };
  const street = (x1: number, z1: number, x2: number, z2: number) => {
    for (let z = z1; z <= z2; z++)
      for (let x = x1; x <= x2; x++) {
        const t = at(x, z);
        if (t.anchor >= 0) throw Error('Street crosses an authored building');
        Object.assign(set(x, z, 'road'), { hasPipe: true, hasPowerLine: true });
      }
  };
  const garden = (x: number, z: number) => Object.assign(set(x, z, 'park'), { variation: 3 });
  const facility = (
    x: number,
    z: number,
    kind: TileKind,
    rotation: 0 | 1 | 2 | 3 = 0,
    variant = (x + z) % 5,
  ) => {
    const fp = TOOL_DEFS[kind]!.footprint!,
      [w, d] = rotation % 2 ? [fp[1], fp[0]] : fp;
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) {
        if (at(x + dx, z + dz).anchor >= 0 || at(x + dx, z + dz).kind === 'road')
          throw Error(`Scenario overlap: ${kind} ${x},${z}`);
        Object.assign(set(x + dx, z + dz, kind), {
          level: 1,
          anchor: z * size + x,
          rotation,
          variation: variant,
          hasPipe: true,
        });
      }
  };
  const parcel = (
    x: number,
    z: number,
    w: number,
    d: number,
    kind: TileKind,
    density: ZoneDensity,
    variant: number,
  ) => {
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) {
        if (!['empty', 'tree', 'park'].includes(at(x + dx, z + dz).kind))
          throw Error(`Parcel overlap ${x},${z}`);
        Object.assign(set(x + dx, z + dz, kind), { zoneDensity: density, variation: variant });
      }
    const t = at(x, z);
    if (w * d > 1 && !claimZoneLot(city, t, [w, d])) throw Error('Scenario parcel claim failed');
    t.level = zoneDensityCap(t);
    syncZoneLot(city, t);
    return t;
  };

  // Broad meadow and woodland belts frame a composed city, rather than filling the region with roads.
  for (const t of city.tiles) {
    const woodland = t.x < 13 || t.z < 12 || t.z > 119;
    const clump = Math.sin(t.x * 0.24) + Math.cos(t.z * 0.21) + Math.sin((t.x + t.z) * 0.12);
    set(t.x, t.z, woodland && clump > 0.3 && (t.x * 7 + t.z * 11) % 4 !== 0 ? 'tree' : 'empty');
    if ((t.x < 10 || t.z < 7) && (t.x + t.z) % 5 !== 0) t.elevation = ((t.x * 3 + t.z) % 4) * 0.5;
  }
  region(124, 0, 4, size, 'water');
  // Walkable eight-tile blocks leave room for genuine courtyards and setbacks.
  for (let x = 16; x <= 104; x += 8) street(x, 16, x, 112);
  for (let z = 16; z <= 112; z += 8) street(16, z, 104, z);

  // Central Park: one generous lake, clear lawns, small planted terraces and woodland edges.
  region(49, 41, 31, 39, 'empty');
  for (let z = 42; z < 79; z++)
    for (let x = 50; x < 79; x++) {
      const lake = ((x - 64) / 10) ** 2 + ((z - 52) / 9) ** 2;
      if (lake < 1) set(x, z, 'water');
      else if ((x < 53 || x > 76 || z > 73) && (x * 3 + z * 7) % 5 === 0) set(x, z, 'tree');
      else if ((z === 62 || z === 72) && x >= 55 && x <= 73) garden(x, z);
    }
  // The park boulevard is deliberately the foreground of the centrally positioned business.
  street(48, 64, 80, 64);
  for (let z = 65; z <= 69; z++) for (let x = 60; x <= 68; x++) garden(x, z);
  region(63, 65, 3, 2, 'commercial');
  for (let z = 65; z < 67; z++) for (let x = 63; x < 66; x++) at(x, z).zoneDensity = 'medium';
  const easterEgg = at(63, 65);
  if (!claimEasterEggLot(city, easterEgg, true))
    throw Error('Central Easter Egg has no open park frontage');
  easterEgg.level = 2;
  syncZoneLot(city, easterEgg);

  // Civic buildings are woven into individual neighborhoods, not copied into identical service courts.
  for (const [x, z] of [
    [25, 25],
    [57, 17],
    [81, 25],
    [17, 49],
    [89, 49],
    [25, 81],
    [57, 89],
    [81, 81],
  ])
    facility(x, z, 'hospital');
  for (const [x, z] of [
    [33, 17],
    [65, 25],
    [89, 33],
    [25, 57],
    [81, 65],
    [41, 89],
    [89, 89],
  ])
    facility(x, z, 'police');
  for (const [x, z] of [
    [17, 33],
    [49, 17],
    [81, 41],
    [17, 73],
    [73, 81],
    [97, 81],
  ])
    facility(x, z, 'fire');
  for (const [x, z] of [
    [25, 41],
    [41, 25],
    [73, 17],
    [89, 57],
    [33, 73],
    [49, 97],
    [81, 97],
  ])
    facility(x, z, 'school');
  for (const [x, z] of [
    [41, 41],
    [73, 33],
    [41, 81],
    [73, 97],
  ])
    facility(x, z, 'hospital');
  for (const [x, z] of [
    [49, 33],
    [33, 49],
    [73, 89],
    [89, 73],
  ])
    facility(x, z, 'police');
  for (const [x, z] of [
    [41, 49],
    [65, 33],
    [49, 81],
    [89, 105],
  ])
    facility(x, z, 'fire');
  for (const [x, z] of [
    [57, 105],
    [17, 89],
  ])
    facility(x, z, 'school');
  facility(57, 33, 'university');
  facility(33, 89, 'university');
  facility(41, 65, 'university');
  facility(81, 73, 'university', 0, 4);
  facility(57, 81, 'stadium');
  street(16, 113, 28, 113);
  facility(17, 114, 'airport');

  // One solar meadow and one compact energy/water campus replace the former utility checkerboard.
  street(104, 8, 104, 120);
  street(120, 16, 120, 120);
  for (const z of [8, 16, 24, 44, 64, 72, 80, 96, 112, 120]) street(104, z, 123, z);
  street(108, 24, 108, 44);
  street(114, 24, 114, 44);
  for (const x of [109, 115]) for (const z of [25, 29, 33, 37]) facility(x, z, 'solar');
  for (const [x, z] of [
    [109, 41],
    [115, 41],
    [121, 17],
    [121, 21],
  ])
    facility(x, z, 'wind');
  street(108, 48, 120, 48);
  street(108, 52, 120, 52);
  street(108, 56, 120, 56);
  street(108, 60, 120, 60);
  street(108, 44, 108, 64);
  for (const x of [109, 112, 115, 118])
    for (const z of [49, 53, 57, 61]) facility(x, z, 'waterpump');
  // Power stations share access lanes and a planted buffer outside the residential districts.
  street(108, 80, 108, 120);
  street(114, 80, 114, 120);
  for (const x of [109, 115])
    for (const z of [81, 86, 91, 97, 102, 107, 113]) facility(x, z, 'power');
  for (const [x, z] of [
    [97, 97],
    [105, 81],
    [105, 105],
  ])
    facility(x, z, 'recycling');
  facility(121, 97, 'seaport', 3);
  facility(121, 105, 'seaport', 3, 4);

  // An agricultural edge along quiet country lanes, with open land between farms and the city.
  for (const z of [8, 16, 64, 72])
    for (const x of [109, 117]) {
      const farm = parcel(x, z + 1, 3, 2, 'commercial', 'low', (x + z) % 5);
      farm.ruralCommercial = true;
      syncZoneLot(city, farm);
    }
  for (const t of city.tiles)
    if (t.kind === 'empty' && t.x >= 106 && t.x < 124 && t.z < 80 && (t.x + t.z) % 7 === 0)
      t.elevation = 0.5;

  let parcelNumber = 0;
  for (let bz = 0; bz < 12; bz++)
    for (let bx = 0; bx < 11; bx++) {
      const x0 = 17 + bx * 8,
        z0 = 17 + bz * 8;
      const industrial = x0 >= 89 && z0 >= 89;
      const inCity = ((x0 + 3 - 60) / 51) ** 2 + ((z0 + 3 - 62) / 56) ** 2 < 1.08;
      if ((!inCity && !industrial) || (x0 >= 97 && !industrial)) continue;
      // Compact skyline north of the lake, flanked by midrise boroughs and garden suburbs.
      const high =
        (x0 >= 41 && x0 < 81 && z0 >= 25 && z0 < 41) ||
        (x0 >= 41 && x0 < 49 && z0 >= 41 && z0 < 65) ||
        (x0 >= 81 && x0 < 89 && z0 >= 33 && z0 < 57);
      const density: ZoneDensity = industrial
        ? z0 < 97
          ? 'high'
          : z0 < 105
            ? 'medium'
            : 'low'
        : high
          ? 'high'
          : x0 >= 25 && x0 < 97 && z0 >= 25 && z0 < 97
            ? 'medium'
            : 'low';
      const kind: TileKind = industrial
        ? 'industrial'
        : (bx + bz * 2) % 6 === 0 || (x0 === 65 && z0 === 25)
          ? 'commercial'
          : 'residential';
      // A green court occupies every block's deep interior; all homes retain street and pipe access.
      for (let dz = 2; dz <= 4; dz++)
        for (let dx = 2; dx <= 4; dx++) {
          const t = at(x0 + dx, z0 + dz);
          if (t.kind === 'empty' && !(t.x >= 49 && t.x <= 79 && t.z >= 41 && t.z <= 79)) {
            if (dx === 3 && dz === 3) garden(t.x, t.z);
            else if ((dx + dz + bx) % 3 === 0) set(t.x, t.z, 'tree');
          }
        }
      for (let dz = 0; dz < 7; dz++)
        for (let dx = 0; dx < 7; dx++) {
          const x = x0 + dx,
            z = z0 + dz,
            t = at(x, z);
          if (
            t.kind !== 'empty' ||
            (dx >= 2 && dx <= 4 && dz >= 2 && dz <= 4) ||
            (x >= 49 && x <= 79 && z >= 41 && z <= 79)
          )
            continue;
          // Low homes have breathing room; larger downtown parcels produce a deliberate skyline rhythm.
          if (density === 'low' && !industrial && (dx + dz + bx) % 5 === 0) {
            if ((dx + dz) % 2 === 0) set(x, z, 'tree');
            continue;
          }
          if (kind === 'residential' && density === 'high' && dx >= 2 && dx <= 4) {
            if (dz === 0 || dz === 6) garden(x, z);
            continue;
          }
          const variant = parcelNumber++ % 5;
          let [w, d] = variant === 4 || variant === 1 ? [3, 2] : variant === 3 ? [2, 2] : [2, 1];
          const free = () =>
            Array.from({ length: w * d }, (_, i) => ({
              x: x + (i % w),
              z: z + Math.floor(i / w),
            })).every(
              (p) =>
                p.x < x0 + 7 &&
                p.z < z0 + 7 &&
                at(p.x, p.z).kind === 'empty' &&
                !(kind === 'residential' && density === 'high' && p.x - x0 >= 2 && p.x - x0 <= 4) &&
                !(p.x - x0 >= 2 && p.x - x0 <= 4 && p.z - z0 >= 2 && p.z - z0 <= 4) &&
                !(p.x >= 49 && p.x <= 79 && p.z >= 41 && p.z <= 79),
            );
          if (!free()) [w, d] = [1, 1];
          parcel(x, z, w, d, kind, density, variant);
        }
    }
  for (const t of city.tiles)
    if (
      t.kind === 'commercial' &&
      t.anchor === t.z * size + t.x &&
      [4, 6].includes(zoneLotArea(t)) &&
      !isEasterEggLot(t) &&
      t.ruralCommercial === undefined
    ) {
      t.ruralCommercial = shouldAssignRuralCommercial(city, t);
      syncZoneLot(city, t);
    }
  city.name = 'Kassel';
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
  // Rotate the authored map itself, including facades and complete multi-tile lots.
  // Anchors must remain the top-left cell of each rotated footprint.
  const rotatedAnchors = new Map<number, number>();
  for (const tile of city.tiles) {
    if (tile.anchor < 0) continue;
    const index = (size - 1 - tile.z) * size + size - 1 - tile.x;
    rotatedAnchors.set(tile.anchor, Math.min(rotatedAnchors.get(tile.anchor) ?? index, index));
  }
  city.tiles = city.tiles
    .map((tile) => ({
      ...tile,
      x: size - 1 - tile.x,
      z: size - 1 - tile.z,
      rotation: ((tile.rotation + 2) % 4) as 0 | 1 | 2 | 3,
      anchor: tile.anchor < 0 ? -1 : rotatedAnchors.get(tile.anchor)!,
    }))
    .reverse();
  recalculate(city);
  city.progression = createProgression();
  city.milestone = 0;
  city.events = [
    {
      id: 1,
      month: 0,
      title: 'Willkommen in Kassel',
      message:
        'Eine große Stadt rund um den Stadtpark: Entdecke das besondere Geschäftsgebäude am See, die Skyline und die grünen Wohnviertel. Die Simulation startet pausiert.',
      titleEn: 'Welcome to Kassel',
      messageEn:
        'A large city around its central park: discover the special business by the lake, the skyline and leafy neighborhoods. The simulation starts paused.',
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
