import type { CityState, Point, Tile } from './types';

export interface PowerServiceCandidate {
  pole: number;
  targetX: number;
  targetZ: number;
  distance: number;
}

const isZone = (tile: Tile) => tile.kind === 'residential' || tile.kind === 'commercial' || tile.kind === 'industrial';
const indexAt = (state: CityState, x: number, z: number) => x < 0 || z < 0 || x >= state.size || z >= state.size ? -1 : z * state.size + x;
/** Match the sidewalk placement and the mast base in createPowerGridModel. */
export const powerPoleCenter = (tile: Tile): [number, number] => {
  const offset = tile.kind === 'road' ? .86 : .5;
  return [tile.x + offset, tile.z + offset];
};

function lotTerminal(footprint: Point[], pole: Tile): [number, number] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const point of footprint) {
    minX = Math.min(minX, point.x); minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x + 1); maxZ = Math.max(maxZ, point.z + 1);
  }
  const [x, z] = powerPoleCenter(pole);
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  // Center on the nearest boundary segment, rather than sending a diagonal cable to a roof.
  // The 5 cm inset leaves the meter's conduit visibly inside the developed foundation.
  if (dx >= dz && dx > 0) return [x < minX ? minX + .05 : maxX - .05, Math.max(minZ + .5, Math.min(maxZ - .5, z))];
  return [Math.max(minX + .5, Math.min(maxX - .5, x)), z < minZ ? minZ + .05 : maxZ - .05];
}

/** Closed rectangle intersection, including the service cable's physical radius. */
function intersectsRectangle(start: [number, number], end: [number, number], minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  const clearance = .007;
  let entry = 0, exit = 1;
  for (const [origin, delta, min, max] of [
    [start[0], end[0] - start[0], minX - clearance, maxX + clearance],
    [start[1], end[1] - start[1], minZ - clearance, maxZ + clearance],
  ]) {
    if (Math.abs(delta) < 1e-10) { if (origin < min || origin > max) return false; continue; }
    const a = (min - origin) / delta, b = (max - origin) / delta;
    entry = Math.max(entry, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return false;
  }
  return true;
}

function crossesAsphalt(state: CityState, road: Tile, start: [number, number], target: [number, number]): boolean {
  const intersects = (minX: number, minZ: number, maxX: number, maxZ: number) =>
    intersectsRectangle(start, target, road.x + minX, road.z + minZ, road.x + maxX, road.z + maxZ);
  const connects = (dx: number, dz: number) => {
    const id = indexAt(state, road.x + dx, road.z + dz);
    return id >= 0 && ['road', 'airport', 'seaport'].includes(state.tiles[id].kind);
  };
  const north = connects(0, -1), east = connects(1, 0), south = connects(0, 1), west = connects(-1, 0);
  const isolated = !north && !east && !south && !west;
  // Exact X/Z bounds of models.ts road(): .67 central square and .34 road arms.
  // Checking asphalt (rather than the whole tile) permits a drop along its own curb.
  return intersects(.165, .165, .835, .835)
    || (north || isolated) && intersects(.165, 0, .835, .34)
    || (south || isolated) && intersects(.165, .66, .835, 1)
    || east && intersects(.66, .165, 1, .835)
    || west && intersects(0, .165, .34, .835);
}

function clearDrop(state: CityState, pole: Tile, target: [number, number], footprintIds: Set<number>, obstructs: (tile: Tile) => boolean): boolean {
  const [poleX, poleZ] = powerPoleCenter(pole);
  // Same cleat as createPowerGridModel; the cable begins south of the mast axis.
  const start: [number, number] = [poleX, poleZ + .077];
  const minX = Math.max(0, Math.floor(Math.min(start[0], target[0]) - .007));
  const maxX = Math.min(state.size - 1, Math.floor(Math.max(start[0], target[0]) + .007));
  const minZ = Math.max(0, Math.floor(Math.min(start[1], target[1]) - .007));
  const maxZ = Math.min(state.size - 1, Math.floor(Math.max(start[1], target[1]) + .007));
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const id = z * state.size + x, tile = state.tiles[id];
    if (tile.kind === 'road' && crossesAsphalt(state, tile, start, target)) return false;
    if (!footprintIds.has(id) && obstructs(tile) && intersectsRectangle(start, target, x, z, x + 1, z + 1)) return false;
  }
  return true;
}

/** Bounded legal service drops; shared by the simulation and visible utility geometry. */
export function powerServiceCandidates(state: CityState, footprint: Point[], obstructs: (tile: Tile) => boolean): PowerServiceCandidate[] {
  const footprintIds = new Set(footprint.map(point => point.z * state.size + point.x));
  const distances = new Map<number, number>();
  for (const point of footprint) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const distance = Math.abs(dx) + Math.abs(dz);
    if (distance > 2) continue;
    const id = indexAt(state, point.x + dx, point.z + dz);
    if (id < 0) continue;
    const tile = state.tiles[id];
    if (!tile.hasPowerLine || tile.fire !== 0 || isZone(tile) || obstructs(tile)) continue;
    distances.set(id, Math.min(distance, distances.get(id) ?? Infinity));
  }
  const candidates: PowerServiceCandidate[] = [];
  for (const [pole, distance] of distances) {
    const target = lotTerminal(footprint, state.tiles[pole]);
    if (clearDrop(state, state.tiles[pole], target, footprintIds, obstructs)) {
      candidates.push({ pole, distance, targetX: target[0], targetZ: target[1] });
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance || a.pole - b.pole);
}

/** Prefer an already supplied block; otherwise choose the strongest physically legal drop. */
export function selectPowerServiceComponent(ownComponent: number, membership: Int32Array, supply: number[], candidates: PowerServiceCandidate[], resolve = (component: number) => component): number {
  ownComponent = ownComponent >= 0 ? resolve(ownComponent) : ownComponent;
  if (ownComponent >= 0 && supply[ownComponent] > 0) return ownComponent;
  let best = ownComponent, bestSupply = 0;
  for (const candidate of candidates) {
    const member = membership[candidate.pole], component = member >= 0 ? resolve(member) : member;
    if (component >= 0 && supply[component] > bestSupply) {
      best = component; bestSupply = supply[component];
    }
  }
  return best;
}

/**
 * A large facility's legal service feeds its entire contiguous building block. Only an
 * unsupplied component can accept a feed, so a service never joins two existing live grids.
 * Component watchers and disjoint sets also handle chains without rescanning all map tiles
 * per facility. Returned incoming drops must remain visible after the networks are joined.
 */
export function applyFacilityPowerFeeds(
  state: CityState,
  network: { membership: Int32Array; supply: number[] },
  facilities: Tile[],
  footprintFor: (tile: Tile) => Point[],
  obstructs: (tile: Tile) => boolean,
): Map<number, PowerServiceCandidate> {
  const { membership, supply } = network;
  const parent = Int32Array.from(supply, (_, component) => component);
  const root = (component: number): number => {
    let current = component;
    while (parent[current] !== current) current = parent[current];
    while (parent[component] !== component) {
      const next = parent[component]; parent[component] = current; component = next;
    }
    return current;
  };
  interface Feed { building: number; component: number; candidates: PowerServiceCandidate[]; }
  const watchers = new Map<number, Feed[]>();
  const incoming = new Map<number, PowerServiceCandidate>();
  for (const tile of [...facilities].sort((a, b) => a.z * state.size + a.x - b.z * state.size - b.x)) {
    const building = tile.z * state.size + tile.x, component = membership[building];
    if (tile.fire !== 0 || component < 0 || supply[component] > 0) continue;
    const footprint = footprintFor(tile);
    if (footprint.length < 2) continue;
    const candidates = powerServiceCandidates(state, footprint, obstructs);
    const feed = { building, component, candidates };
    for (const from of new Set(candidates.map(candidate => membership[candidate.pole]))) {
      if (from < 0 || from === component) continue;
      const waiting = watchers.get(from) ?? [];
      waiting.push(feed); watchers.set(from, waiting);
    }
  }
  const queue = supply.flatMap((capacity, component) => capacity > 0 ? [component] : []);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const feed of watchers.get(queue[cursor]) ?? []) {
      const own = root(feed.component);
      if (supply[own] > 0) continue;
      const from = selectPowerServiceComponent(own, membership, supply, feed.candidates, root);
      if (from < 0 || supply[from] <= 0) continue;
      const candidate = feed.candidates.find(item => membership[item.pole] >= 0 && root(membership[item.pole]) === from)!;
      incoming.set(feed.building, candidate);
      parent[own] = from;
      supply[from] += supply[own]; supply[own] = 0;
      queue.push(own);
    }
  }
  for (let id = 0; id < membership.length; id++) if (membership[id] >= 0) membership[id] = root(membership[id]);
  return incoming;
}
