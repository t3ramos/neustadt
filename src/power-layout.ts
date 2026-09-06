import type { CityState, Point, Tile } from './types';
import { getFootprint, isBuildingAnchor, TOOL_DEFS } from './simulation';
import { sampleRoadHeight } from './road-graphics';
import { sampleGroundHeight } from './terrain-graphics';

export interface PowerPole {
  /** Stable tile index; x/z are integer tile coordinates. Roads use curb centers at +0.86, other tiles +0.5. */
  id: number;
  x: number;
  z: number;
  elevation: number;
  /** Cardinal offsets to the immediately adjacent, explicitly wired tiles. */
  directions: Array<[number, number]>;
}

export interface PowerSpan {
  from: number;
  to: number;
  /** Complete orthogonal line path, including both pole tile IDs. Never crosses a building. */
  path: number[];
}

export interface PowerService {
  building: number;
  pole: number;
  /** Continuous tile coordinates, already including the offset within the lot. */
  targetX: number;
  targetZ: number;
  /** The building foundation height; the renderer adds its terminal's physical height. */
  elevation: number;
  powered: boolean;
}

export interface PowerLayout {
  poles: PowerPole[];
  spans: PowerSpan[];
  services: PowerService[];
}

const OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const isZone = (tile: Tile) => tile.kind === 'residential' || tile.kind === 'commercial' || tile.kind === 'industrial';
const isFacility = (tile: Tile) => !!TOOL_DEFS[tile.kind]?.footprint;
const hasBuilding = (tile: Tile) => isFacility(tile) || isZone(tile) && tile.level > 0;
const conducts = (tile: Tile) => tile.fire === 0 && (tile.hasPowerLine || hasBuilding(tile));
const sourceCapacity = (tile: Tile) => tile.kind === 'power' ? 6000 : tile.kind === 'wind' ? 1200 : tile.kind === 'solar' ? 3200 : 0;
const indexAt = (state: CityState, x: number, z: number) => x < 0 || z < 0 || x >= state.size || z >= state.size ? -1 : z * state.size + x;
// Match the renderer's sidewalk placement, including service-ray occlusion and the mast base.
const poleCenter = (tile: Tile): [number, number] => {
  const offset = tile.kind === 'road' ? .86 : .5;
  return [tile.x + offset, tile.z + offset];
};

interface Network {
  membership: Int32Array;
  supply: number[];
}

/** Mirror the simulation: buildings conduct too, but only explicit open-air lines get poles. */
function makeNetwork(state: CityState): Network {
  const membership = new Int32Array(state.tiles.length).fill(-1);
  const supply: number[] = [];
  for (let start = 0; start < state.tiles.length; start++) {
    if (membership[start] >= 0 || !conducts(state.tiles[start])) continue;
    const component = supply.length, queue = [start];
    supply.push(0);
    membership[start] = component;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const tile = state.tiles[queue[cursor]];
      if (isBuildingAnchor(state, tile)) supply[component] += sourceCapacity(tile);
      for (const [dx, dz] of OFFSETS) {
        const next = indexAt(state, tile.x + dx, tile.z + dz);
        if (next >= 0 && membership[next] < 0 && conducts(state.tiles[next])) {
          membership[next] = component;
          queue.push(next);
        }
      }
    }
  }
  return { membership, supply };
}

/** Keep the exact footprint / dz / dx order used by simulation.findNetwork for supply ties. */
function servingComponent(state: CityState, network: Network, footprint: Point[]): number {
  let best = -1, bestSupply = -1;
  for (const point of footprint) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    if (Math.abs(dx) + Math.abs(dz) > 2) continue;
    const id = indexAt(state, point.x + dx, point.z + dz);
    if (id < 0) continue;
    const component = network.membership[id];
    if (component >= 0 && network.supply[component] > bestSupply) {
      best = component;
      bestSupply = network.supply[component];
    }
  }
  return best;
}

function lotTerminal(footprint: Point[], pole: Tile): [number, number] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const point of footprint) {
    minX = Math.min(minX, point.x); minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x + 1); maxZ = Math.max(maxZ, point.z + 1);
  }
  const [x, z] = poleCenter(pole);
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  // Center on the nearest boundary segment, rather than sending a diagonal cable to a roof.
  // The 5 cm inset leaves the meter's conduit visibly inside the developed foundation.
  if (dx >= dz && dx > 0) return [x < minX ? minX + .05 : maxX - .05, Math.max(minZ + .5, Math.min(maxZ - .5, z))];
  return [Math.max(minX + .5, Math.min(maxX - .5, x)), z < minZ ? minZ + .05 : maxZ - .05];
}

function clearDrop(state: CityState, pole: Tile, target: [number, number], footprintIds: Set<number>): boolean {
  const [startX, startZ] = poleCenter(pole);
  const steps = Math.ceil(Math.hypot(target[0] - startX, target[1] - startZ) / .15);
  const poleId = pole.z * state.size + pole.x;
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const id = indexAt(state, Math.floor(startX + (target[0] - startX) * t), Math.floor(startZ + (target[1] - startZ) * t));
    if (id >= 0 && id !== poleId && !footprintIds.has(id) && hasBuilding(state.tiles[id])) return false;
  }
  return true;
}

/**
 * Linear network construction plus bounded, radius-two service searches. A service is a
 * faithful local visualization of the assigned powered network; remote buildings may receive
 * electricity through the simulation's building conductors without a fictitious overhead drop.
 */
export function getPowerLayout(state: CityState): PowerLayout {
  const network = makeNetwork(state);
  const lines = new Map<number, number[]>();
  const poleIds = new Set<number>();
  for (let id = 0; id < state.tiles.length; id++) {
    const tile = state.tiles[id];
    if (!tile.hasPowerLine || tile.fire !== 0 || hasBuilding(tile)) continue;
    const neighbors: number[] = [];
    for (const [dx, dz] of OFFSETS) {
      const next = indexAt(state, tile.x + dx, tile.z + dz);
      if (next >= 0) {
        const neighbor = state.tiles[next];
        if (neighbor.hasPowerLine && neighbor.fire === 0 && !hasBuilding(neighbor)) neighbors.push(next);
      }
    }
    lines.set(id, neighbors);
    const horizontal = neighbors.length === 2 && state.tiles[neighbors[0]].z === state.tiles[neighbors[1]].z;
    const vertical = neighbors.length === 2 && state.tiles[neighbors[0]].x === state.tiles[neighbors[1]].x;
    if (neighbors.length !== 2 || !horizontal && !vertical || horizontal && tile.x % 3 === 0 || vertical && tile.z % 3 === 0) poleIds.add(id);
  }

  const services: PowerService[] = [];
  for (let building = 0; building < state.tiles.length; building++) {
    const tile = state.tiles[building];
    if (!hasBuilding(tile) || tile.fire !== 0 || !isBuildingAnchor(state, tile)) continue;
    const footprint = getFootprint(state, tile);
    // Sources export into their own conductive component, even beside a stronger other source.
    const component = sourceCapacity(tile) > 0 ? network.membership[building] : servingComponent(state, network, footprint);
    if (component < 0 || network.supply[component] <= 0) continue;
    const footprintIds = new Set(footprint.map(point => point.z * state.size + point.x));
    const candidateDistances = new Map<number, number>();
    for (const point of footprint) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const distance = Math.abs(dx) + Math.abs(dz);
      if (distance > 2) continue;
      const id = indexAt(state, point.x + dx, point.z + dz);
      if (id < 0 || !lines.has(id) || network.membership[id] !== component) continue;
      candidateDistances.set(id, Math.min(distance, candidateDistances.get(id) ?? Infinity));
    }
    const candidates = [...candidateDistances.keys()].sort((a, b) => Number(poleIds.has(b)) - Number(poleIds.has(a)) || candidateDistances.get(a)! - candidateDistances.get(b)! || a - b);
    for (const pole of candidates) {
      const target = lotTerminal(footprint, state.tiles[pole]);
      if (!clearDrop(state, state.tiles[pole], target, footprintIds)) continue;
      poleIds.add(pole);
      services.push({ building, pole, targetX: target[0], targetZ: target[1], elevation: tile.elevation, powered: tile.powered });
      break;
    }
  }

  const poles: PowerPole[] = [...poleIds].sort((a, b) => a - b).map(id => {
    const tile = state.tiles[id], [gridX, gridZ] = poleCenter(tile);
    const x = gridX - state.size / 2, z = gridZ - state.size / 2;
    return {
      id, x: tile.x, z: tile.z,
      elevation: tile.kind === 'road' || tile.kind === 'rail' ? sampleRoadHeight(state, x, z) : sampleGroundHeight(state, x, z),
      directions: lines.get(id)!.map(next => [state.tiles[next].x - tile.x, state.tiles[next].z - tile.z]),
    };
  });
  const spans: PowerSpan[] = [];
  const visited = new Set<string>();
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (const pole of poles) for (const neighbor of lines.get(pole.id)!) {
    if (visited.has(edgeKey(pole.id, neighbor))) continue;
    const path = [pole.id];
    let previous = pole.id, current = neighbor;
    while (true) {
      visited.add(edgeKey(previous, current));
      path.push(current);
      if (poleIds.has(current)) break;
      const next = lines.get(current)!.find(id => id !== previous)!;
      previous = current; current = next;
    }
    spans.push({ from: pole.id, to: current, path });
  }
  return { poles, spans, services };
}

/** Cache only graph/render inputs; money, simulation month, weather and unrelated stats do not matter. */
export function powerLayoutSignature(state: CityState): string {
  const parts = [`${state.size}`];
  for (let id = 0; id < state.tiles.length; id++) {
    const tile = state.tiles[id];
    if (tile.hasPowerLine || isFacility(tile) || isZone(tile)) {
      parts.push(`${id}:${tile.kind}:${tile.level}:${tile.elevation}:${tile.anchor}:${tile.rotation}:${tile.fire}:${Number(tile.hasPowerLine)}:${Number(tile.powered)}`);
    }
    // Open-air mast bases interpolate their surrounding terrain/road corners. Adjacent terrain
    // edits must invalidate the layout too, even when none of the wired cells themselves changed.
    if (!tile.hasPowerLine || hasBuilding(tile)) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const neighbor = indexAt(state, tile.x + dx, tile.z + dz);
      if (neighbor >= 0) {
        const other = state.tiles[neighbor];
        parts.push(`${neighbor}g${other.elevation}:${other.kind}`);
      }
    }
  }
  return parts.join('|');
}
