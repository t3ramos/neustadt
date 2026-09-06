/** Deterministic city creation and non-destructive map expansion. */
import { zoneLotArea } from '../buildings/lots';
import type { CityState, Point } from '../domain/types';
import { tr } from '../i18n/index';
import { getTerrainElevation, isForestTerrain, legacyWaterTerrain } from '../world/terrain';
import { POP } from './catalog';
import {
  dimensions,
  getFootprint,
  isBuildingAnchor,
  isFacility,
  isZone,
  point,
  random,
  tileAt,
} from './city-queries';
import { blankStats, recalculate } from './economy';
import { addEvent } from './events';
import { createProgression, updateProgression } from './progression';
import { clearTile, connectFacility, newTile, placeFacility } from './tile-operations';
import { initializeWeather } from './weather-cycle';

export function createCity(seed = 2026, empty = false, size = 128): CityState {
  seed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 2026;
  if (![40, 64, 96, 128].includes(size)) size = 128;
  const state: CityState = {
    version: 2,
    citizenEffects: {
      populationLoss: 0,
      happinessPenalty: 0,
      incidents: [],
    },
    name: 'Lindenbucht',
    size,
    seed,
    tiles: [],
    money: 85000,
    month: 0,
    tickProgress: 0,
    speed: 1,
    tax: 9,
    funding: {
      police: 100,
      fire: 100,
      health: 100,
      education: 100,
    },
    loan: 0,
    stats: blankStats(),
    events: [],
    history: [],
    revision: 0,
    milestone: 0,
    progression: createProgression(),
    settings: {
      disastersEnabled: false,
      weather: 'clear',
      dynamicWeather: true,
      dayNightCycle: true,
      timeOfDay: 14,
      buildingLights: true,
    },
  };
  initializeWeather(state);
  const offset = Math.floor((size - 40) * 0.4);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const elevation = getTerrainElevation(x, z, size, seed);
      const forest =
        elevation >= 0 &&
        isForestTerrain(x, z, size, seed) &&
        (empty || !(x >= offset + 7 && x <= offset + 29 && z >= offset + 7 && z <= offset + 29));
      state.tiles.push(
        newTile(x, z, seed, elevation, forest ? 'tree' : elevation < 0 ? 'water' : 'empty'),
      );
    }
  if (!empty) {
    for (let z = 8; z <= 28; z++)
      for (let x = 8; x <= 28; x++) {
        const t = tileAt(state, x + offset, z + offset)!;
        t.elevation = 0;
        if ((x - 8) % 5 === 0 || (z - 8) % 5 === 0) {
          t.kind = 'road';
          t.hasPipe = true;
          t.hasPowerLine = true;
          continue;
        }
        const r = random(seed, x, z, 3);
        const downtown = Math.abs(x - 18) + Math.abs(z - 17);
        if (x >= 24 && z >= 23 && r < 0.84) {
          t.kind = 'industrial';
          t.level = r < 0.35 ? 2 : 1;
        } else if (downtown < 8 && r < 0.48) {
          t.kind = 'commercial';
          t.level = downtown < 4 ? 3 : 2;
        } else if (r < 0.55 && !(x >= 24 && z >= 20)) {
          t.kind = 'residential';
          t.level = downtown < 6 ? (r < 0.25 ? 4 : 3) : downtown < 12 ? 2 : 1;
        } else if (r > 0.83) t.kind = 'tree';
        t.age = t.level ? 12 : 0;
      }
    for (const [x, z] of [
      [17, 17],
      [19, 17],
      [17, 19],
      [12, 12],
      [22, 12],
      [12, 22],
      [22, 22],
      [27, 12],
    ]) {
      const t = tileAt(state, x + offset, z + offset)!;
      t.kind = 'park';
      t.level = 0;
    }
    for (const [x, z, kind] of [
      [14, 3, 'power'],
      [24, 4, 'waterpump'],
      [3, 11, 'school'],
      [3, 17, 'police'],
      [3, 21, 'fire'],
      [14, 30, 'hospital'],
    ] as const) {
      const p = { x: x + offset, z: z + offset };
      const [w, d] = dimensions(kind);
      for (let dz = 0; dz < d; dz++)
        for (let dx = 0; dx < w; dx++) tileAt(state, p.x + dx, p.z + dz)!.elevation = 0;
      placeFacility(state, p, kind);
      connectFacility(state, p);
    }
    for (const t of state.tiles) if (isZone(t.kind)) t.level = Math.min(t.level, 2);
    let population = state.tiles.reduce(
      (s, t) =>
        s +
        (t.kind === 'residential' && isBuildingAnchor(state, t)
          ? POP[t.level] * zoneLotArea(t)
          : 0),
      0,
    );
    for (const t of state.tiles
      .filter((t) => t.kind === 'residential')
      .sort((a, b) => a.level - b.level)) {
      if (population <= 2200) break;
      if (t.level === 1) {
        population -= POP[t.level];
        t.kind = 'tree';
        t.level = 0;
      } else {
        population -= POP[t.level] - POP[t.level - 1];
        t.level--;
      }
    }
    for (const t of state.tiles) {
      if (population >= 2000) break;
      if (t.kind === 'residential' && t.level < 2) {
        population += POP[t.level + 1] - POP[t.level];
        t.level++;
      }
    }
    addEvent(
      state,
      ['Willkommen in Lindenbucht', 'Welcome to Lindenbucht'],
      [
        'Deine Stadt ist bereit. Neue Viertel, Forschung und Stadtaufträge warten auf dich. Straßen, Stromleitungen und Wasserrohre bilden eigene Netze.',
        'Your city is ready. New districts, research and city missions await. Roads, power lines and water pipes form separate networks.',
      ],
      'good',
    );
  } else
    addEvent(
      state,
      ['Ein neuer Anfang', 'A fresh start'],
      [
        'Baue Straßen, Kraftwerk und Wasserwerk. Verbinde Stromleitungen und Wasserrohre mit den Anlagen und erschließe Wohn- und Arbeitsgebiete.',
        'Build roads, a power plant and a waterworks. Connect power lines and water pipes to the facilities and provide access to housing and workplaces.',
      ],
    );
  recalculate(state);
  state.progression = createProgression(state);
  updateProgression(state);
  state.history.push({
    month: 0,
    population: state.stats.population,
    money: state.money,
    happiness: state.stats.happiness,
  });
  state.revision = 0;
  return state;
}

/** Enlarge without moving or discarding the existing city. Legacy one-tile facilities get real plots. */
export function expandCity(original: CityState, newSize = 128): CityState {
  if (![64, 96, 128].includes(newSize) || newSize < original.size)
    throw new Error(
      tr(
        'Eine Stadt kann nur auf 64, 96 oder 128 Felder erweitert werden.',
        'A city can only be expanded to 64, 96 or 128 tiles.',
      ),
    );
  if (newSize === original.size) return structuredClone(original);
  const state = structuredClone(original);
  const oldSize = state.size;
  const oldTiles = state.tiles;
  state.size = newSize;
  state.tiles = [];
  // Only the original fixed, flat map needs its historical estuary continuation.
  // Modern mountainous 40-field saves keep every existing tile but receive the new
  // full-sized valley outside their bounds, rather than a spurious water strip.
  const historicalFlatCoast =
    oldSize === 40 &&
    oldTiles.every((tile) => tile.elevation === (legacyWaterTerrain(tile.x, tile.z) ? -1 : 0));
  const oldSouthCoast =
    oldTiles.slice((oldSize - 1) * oldSize).find((t) => t.elevation < 0)?.x ?? oldSize;
  for (let z = 0; z < newSize; z++)
    for (let x = 0; x < newSize; x++) {
      if (x < oldSize && z < oldSize) {
        const t = { ...oldTiles[z * oldSize + x] };
        if (t.anchor >= 0)
          t.anchor = Math.floor(t.anchor / oldSize) * newSize + (t.anchor % oldSize);
        state.tiles.push(t);
        continue;
      }
      let elevation = getTerrainElevation(x, z, newSize, state.seed);
      if (historicalFlatCoast) {
        const oldEdge = oldTiles[(oldSize - 1) * oldSize + Math.min(x, oldSize - 1)];
        if (z < 40 && x >= 40) elevation = -1;
        else if (z >= 40 && z < 76) {
          const shoreline = oldSouthCoast + ((z - 40) / 36) * (newSize * 0.79 - oldSouthCoast);
          if (x < 40 && z === 40) elevation = oldEdge.elevation;
          else if (x >= shoreline) elevation = -1;
        }
      }
      const forest = elevation >= 0 && isForestTerrain(x, z, newSize, state.seed);
      state.tiles.push(
        newTile(x, z, state.seed, elevation, forest ? 'tree' : elevation < 0 ? 'water' : 'empty'),
      );
    }
  const compact = state.tiles.filter(
    (t) => isFacility(t.kind) && isBuildingAnchor(state, t) && getFootprint(state, t).length === 1,
  );
  const legacyKinds = compact.map((t) => t.kind);
  for (const old of compact) {
    const kind = old.kind;
    const rotation = old.rotation;
    const [w, d] = dimensions(kind, rotation);
    const origin = point(old);
    const fire = old.fire;
    const age = old.age;
    let chosen: Point | null = null;
    clearTile(old); // Preserve utilities at the old address; no neighboring homes are altered.
    const available = (x: number, z: number) => {
      if (x < 0 || z < 0 || x + w > newSize || z + d > newSize) return false;
      for (let dz = 0; dz < d; dz++)
        for (let dx = 0; dx < w; dx++) {
          const t = tileAt(state, x + dx, z + dz)!;
          if (t.elevation < 0 || !['empty', 'tree', 'rubble'].includes(t.kind)) return false;
        }
      if (kind === 'seaport') {
        let edges = 0;
        for (let dx = 0; dx < w; dx++)
          if ((tileAt(state, x + dx, z + d)?.elevation ?? 0) < 0) edges++;
        return edges >= 2;
      }
      return true;
    };
    outer: for (let radius = 0; radius < newSize * 2; radius++)
      for (let dz = -radius; dz <= radius; dz++) {
        const dx = radius - Math.abs(dz);
        for (const sign of dx === 0 ? [1] : [-1, 1]) {
          const x = origin.x + dx * sign;
          const z = origin.z + dz;
          if (available(x, z)) {
            chosen = { x, z };
            break outer;
          }
        }
      }
    if (!chosen) {
      old.kind = kind;
      old.anchor = old.z * newSize + old.x;
      old.level = 1;
      old.rotation = rotation;
      old.fire = fire;
      old.age = age;
      continue;
    }
    const elevation = tileAt(state, chosen.x, chosen.z)!.elevation;
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++)
        tileAt(state, chosen.x + dx, chosen.z + dz)!.elevation = elevation;
    placeFacility(state, chosen, kind, rotation);
    for (const p of getFootprint(state, tileAt(state, chosen.x, chosen.z)!)) {
      const t = tileAt(state, p.x, p.z)!;
      t.fire = fire;
      t.age = age;
    }
    connectFacility(state, chosen);
  }
  // Sources that moved during migration must reach the existing road-side utility trunks.
  recalculate(state);
  state.money = original.money;
  state.month = original.month;
  state.tickProgress = original.tickProgress ?? 0;
  state.progression.unlocked = [...new Set([...state.progression.unlocked, ...legacyKinds])];
  addEvent(
    state,
    ['Neue Horizonte', 'New horizons'],
    [
      `Das Stadtgebiet umfasst jetzt ${newSize} × ${newSize} Felder. Bestehende Wohn- und Arbeitsgebiete wurden erhalten; öffentliche Gebäude haben eigene große Grundstücke.`,
      `The city now covers ${newSize} × ${newSize} tiles. Existing housing and workplaces were preserved; public buildings have their own large lots.`,
    ],
    'good',
  );
  state.revision++;
  return state;
}
