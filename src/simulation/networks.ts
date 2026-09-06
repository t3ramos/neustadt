/** Connected utility components, supply allocation and local field stamping. */
import { zoneLotArea } from '../buildings/lots';
import type { CityState, Point, Stats, Tile, TileKind } from '../domain/types';
import { getPowerBlockMask } from '../infrastructure/power-block';
import { applyFacilityPowerFeeds } from '../infrastructure/power-service';
import { COM_JOBS, IND_JOBS, POP } from './catalog';
import { getFootprint, hasStructure, isBuilding, isFacility, random, tileAt } from './city-queries';

export const OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

interface Network {
  membership: Int32Array;
  supply: number[];
  demand: number[];
}

function makeNetwork(state: CityState, predicate: (t: Tile) => boolean): Network {
  const membership = new Int32Array(state.tiles.length).fill(-1);
  const supply: number[] = [];
  const demand: number[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    if (membership[i] >= 0 || !predicate(state.tiles[i])) continue;
    const id = supply.length;
    const queue = [i];
    supply.push(0);
    demand.push(0);
    membership[i] = id;
    for (let p = 0; p < queue.length; p++) {
      const t = state.tiles[queue[p]];
      for (const [dx, dz] of OFFSETS) {
        const neighbor = tileAt(state, t.x + dx, t.z + dz);
        if (!neighbor) continue;
        const j = neighbor.z * state.size + neighbor.x;
        if (membership[j] < 0 && predicate(neighbor)) {
          membership[j] = id;
          queue.push(j);
        }
      }
    }
  }
  return {
    membership,
    supply,
    demand,
  };
}

function findNetwork(state: CityState, network: Network, tile: Tile): number {
  let best = -1;
  let bestSupply = -1;
  for (const p of getFootprint(state, tile))
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > 2) continue;
        const t = tileAt(state, p.x + dx, p.z + dz);
        if (!t) continue;
        const id = network.membership[t.z * state.size + t.x];
        if (id >= 0 && network.supply[id] > bestSupply) {
          best = id;
          bestSupply = network.supply[id];
        }
      }
  return best;
}

function utilityUse(t: Tile): [number, number] {
  const area = zoneLotArea(t);
  if (t.kind === 'residential') return [(6 + t.level * 8) * area, (5 + t.level * 7) * area];
  if (t.kind === 'commercial') return [(8 + t.level * 14) * area, (6 + t.level * 9) * area];
  if (t.kind === 'industrial') return [(12 + t.level * 18) * area, (10 + t.level * 15) * area];
  if (['power', 'wind', 'solar'].includes(t.kind)) return [0, 0];
  if (t.kind === 'waterpump') return [80, 0];
  if (isFacility(t.kind)) return [50, 35];
  return [0, 0];
}

function capacity(kind: TileKind): number {
  return kind === 'power' ? 6000 : kind === 'wind' ? 1200 : kind === 'solar' ? 3200 : 0;
}

export function stamp(
  state: CityState,
  field: Float32Array,
  t: Point,
  radius: number,
  strength: number,
  maximum = false,
): void {
  for (let z = Math.max(0, t.z - radius + 1); z <= Math.min(state.size - 1, t.z + radius - 1); z++)
    for (
      let x = Math.max(0, t.x - radius + 1);
      x <= Math.min(state.size - 1, t.x + radius - 1);
      x++
    ) {
      const d = Math.abs(x - t.x) + Math.abs(z - t.z);
      if (d >= radius) continue;
      const id = z * state.size + x;
      const v = strength * (1 - d / radius);
      field[id] = maximum ? Math.max(field[id], v) : field[id] + v;
    }
}

export function updateUtilityNetworks(
  state: CityState,
  anchors: Tile[],
  buildings: Tile[],
  stats: Stats,
): {
  commercialJobs: number;
  industrialJobs: number;
} {
  const n = state.tiles.length;
  const roadAccess = new Float32Array(n);
  for (const t of state.tiles) if (t.kind === 'road') stamp(state, roadAccess, t, 3, 1, true);
  const blockMask = getPowerBlockMask(state);
  const power = makeNetwork(
    state,
    (t) =>
      t.fire === 0 &&
      (t.hasPowerLine || isBuilding(t.kind) || blockMask[t.z * state.size + t.x] === 1),
  );
  const water = makeNetwork(state, (t) => t.hasPipe || t.kind === 'waterpump');
  for (const t of buildings) {
    const supply = t.fire === 0 ? capacity(t.kind) : 0;
    stats.powerSupply += supply;
    if (supply) {
      const id = power.membership[t.z * state.size + t.x];
      if (id >= 0) power.supply[id] += supply;
    }
  }
  applyFacilityPowerFeeds(
    state,
    power,
    buildings.filter((t) => isFacility(t.kind)),
    (t) => getFootprint(state, t),
    hasStructure,
  );
  const powerAssigned = new Int32Array(n).fill(-1);
  const waterAssigned = new Int32Array(n).fill(-1);
  let commercialJobs = 0;
  let industrialJobs = 0;
  for (const t of anchors) {
    const i = t.z * state.size + t.x;
    const [p, w] = utilityUse(t);
    stats.powerDemand += p;
    stats.waterDemand += w;
    const id = power.membership[i];
    powerAssigned[i] = id;
    if (id >= 0) power.demand[id] += p;
    if (t.kind === 'residential') stats.population += POP[t.level] * zoneLotArea(t);
    if (t.kind === 'commercial') commercialJobs += COM_JOBS[t.level] * zoneLotArea(t);
    if (t.kind === 'industrial') industrialJobs += IND_JOBS[t.level] * zoneLotArea(t);
    if (t.kind === 'park' || t.kind === 'beach') stats.parks++;
  }
  for (const t of anchors) {
    const i = t.z * state.size + t.x;
    const id = powerAssigned[i];
    const source = capacity(t.kind) > 0 && t.fire === 0;
    t.connected = getFootprint(state, t).some((p) => roadAccess[p.z * state.size + p.x] > 0);
    t.powered =
      t.fire === 0 &&
      (source ||
        (id >= 0 &&
          power.supply[id] > 0 &&
          random(state.seed, t.x, t.z, 111) <
            Math.min(1, power.supply[id] / Math.max(1, power.demand[id]))));
    if (t.kind === 'waterpump' && t.powered) {
      const w = water.membership[i];
      if (w >= 0) {
        water.supply[w] += 6000;
        stats.waterSupply += 6000;
      }
    }
  }
  for (const t of anchors) {
    const i = t.z * state.size + t.x;
    const id = findNetwork(state, water, t);
    waterAssigned[i] = id;
    if (id >= 0) water.demand[id] += utilityUse(t)[1];
  }
  for (const t of anchors) {
    const i = t.z * state.size + t.x;
    const id = waterAssigned[i];
    t.watered =
      t.fire === 0 &&
      id >= 0 &&
      water.supply[id] > 0 &&
      random(state.seed, t.x, t.z, 222) <
        Math.min(1, water.supply[id] / Math.max(1, water.demand[id]));
    for (const p of getFootprint(state, t)) {
      const f = state.tiles[p.z * state.size + p.x];
      f.connected = t.connected;
      f.powered = t.powered;
      f.watered = t.watered;
    }
  }
  return { commercialJobs, industrialJobs };
}
