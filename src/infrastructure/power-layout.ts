import type { CityState, Tile } from '../domain/types';
import { getFootprint, isBuildingAnchor, TOOL_DEFS } from '../simulation/city-simulation';
import { sampleRoadHeight } from '../rendering/infrastructure/roads';
import { sampleGroundHeight } from '../rendering/world/terrain';
import { applyFacilityPowerFeeds, powerPoleCenter, powerServiceCandidates } from './power-service';
import { getPowerBlockMask } from './power-block';

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

const OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;
const isZone = (tile: Tile) =>
  tile.kind === 'residential' || tile.kind === 'commercial' || tile.kind === 'industrial';
const isFacility = (tile: Tile) => !!TOOL_DEFS[tile.kind]?.footprint;
const needsService = (tile: Tile) => {
  const footprint = TOOL_DEFS[tile.kind]?.footprint;
  return !!footprint && footprint[0] * footprint[1] > 1;
};
const hasBuilding = (tile: Tile) => isFacility(tile) || (isZone(tile) && tile.level > 0);
const sourceCapacity = (tile: Tile) =>
  tile.kind === 'power' ? 6000 : tile.kind === 'wind' ? 1200 : tile.kind === 'solar' ? 3200 : 0;
const indexAt = (state: CityState, x: number, z: number) =>
  x < 0 || z < 0 || x >= state.size || z >= state.size ? -1 : z * state.size + x;

interface Network {
  membership: Int32Array;
  supply: number[];
}

/** Mirror the simulation: contiguous zoned blocks conduct too, including vacant zoned lots. */
function makeNetwork(state: CityState): Network {
  const blockMask = getPowerBlockMask(state);
  const conducts = (tile: Tile) =>
    tile.fire === 0 &&
    (tile.hasPowerLine ||
      isFacility(tile) ||
      isZone(tile) ||
      blockMask[tile.z * state.size + tile.x] === 1);
  const membership = new Int32Array(state.tiles.length).fill(-1);
  const supply: number[] = [];
  for (let start = 0; start < state.tiles.length; start++) {
    if (membership[start] >= 0 || !conducts(state.tiles[start])) continue;
    const component = supply.length,
      queue = [start];
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

/**
 * Linear network construction plus bounded, radius-two service searches. A service is a
 * local visualization for large facilities only. Ordinary lots share their block's supply
 * without overhead service drops or meters, regardless of their development level.
 */
export function getPowerLayout(state: CityState): PowerLayout {
  const network = makeNetwork(state);
  const facilityFeeds = applyFacilityPowerFeeds(
    state,
    network,
    state.tiles.filter((tile) => needsService(tile) && isBuildingAnchor(state, tile)),
    (tile) => getFootprint(state, tile),
    hasBuilding,
  );
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
        if (neighbor.hasPowerLine && neighbor.fire === 0 && !hasBuilding(neighbor))
          neighbors.push(next);
      }
    }
    lines.set(id, neighbors);
    const horizontal =
      neighbors.length === 2 && state.tiles[neighbors[0]].z === state.tiles[neighbors[1]].z;
    const vertical =
      neighbors.length === 2 && state.tiles[neighbors[0]].x === state.tiles[neighbors[1]].x;
    if (
      neighbors.length !== 2 ||
      (!horizontal && !vertical) ||
      (horizontal && tile.x % 3 === 0) ||
      (vertical && tile.z % 3 === 0)
    )
      poleIds.add(id);
  }

  const services: PowerService[] = [];
  for (let building = 0; building < state.tiles.length; building++) {
    const tile = state.tiles[building];
    if (!needsService(tile) || tile.fire !== 0 || !isBuildingAnchor(state, tile)) continue;
    const footprint = getFootprint(state, tile);
    const candidates = powerServiceCandidates(state, footprint, hasBuilding);
    // Legal incoming facility feeds have already joined their receiving block to its source.
    const component = network.membership[building];
    if (component < 0 || network.supply[component] <= 0) continue;
    const candidate =
      facilityFeeds.get(building) ??
      candidates
        .filter((item) => network.membership[item.pole] === component && lines.has(item.pole))
        .sort(
          (a, b) =>
            Number(poleIds.has(b.pole)) - Number(poleIds.has(a.pole)) ||
            a.distance - b.distance ||
            a.pole - b.pole,
        )[0];
    if (!candidate) continue;
    const { pole, targetX, targetZ } = candidate;
    poleIds.add(pole);
    services.push({
      building,
      pole,
      targetX,
      targetZ,
      elevation: tile.elevation,
      powered: tile.powered,
    });
  }

  const poles: PowerPole[] = [...poleIds]
    .sort((a, b) => a - b)
    .map((id) => {
      const tile = state.tiles[id],
        [gridX, gridZ] = powerPoleCenter(tile);
      const x = gridX - state.size / 2,
        z = gridZ - state.size / 2;
      return {
        id,
        x: tile.x,
        z: tile.z,
        elevation:
          tile.kind === 'road' || tile.kind === 'rail'
            ? sampleRoadHeight(state, x, z)
            : sampleGroundHeight(state, x, z),
        directions: lines
          .get(id)!
          .map((next) => [state.tiles[next].x - tile.x, state.tiles[next].z - tile.z]),
      };
    });
  const spans: PowerSpan[] = [];
  const visited = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (const pole of poles)
    for (const neighbor of lines.get(pole.id)!) {
      if (visited.has(edgeKey(pole.id, neighbor))) continue;
      const path = [pole.id];
      let previous = pole.id,
        current = neighbor;
      while (true) {
        visited.add(edgeKey(previous, current));
        path.push(current);
        if (poleIds.has(current)) break;
        const next = lines.get(current)!.find((id) => id !== previous)!;
        previous = current;
        current = next;
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
    if (
      tile.hasPowerLine ||
      isFacility(tile) ||
      isZone(tile) ||
      ['road', 'rail', 'water'].includes(tile.kind) ||
      tile.elevation < 0 ||
      tile.fire !== 0
    ) {
      parts.push(
        `${id}:${tile.kind}:${tile.level}:${tile.elevation}:${tile.anchor}:${tile.rotation}:${tile.fire}:${Number(tile.hasPowerLine)}:${Number(tile.powered)}`,
      );
    }
    // Open-air mast bases interpolate their surrounding terrain/road corners. Adjacent terrain
    // edits must invalidate the layout too, even when none of the wired cells themselves changed.
    if (!tile.hasPowerLine || hasBuilding(tile)) continue;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const neighbor = indexAt(state, tile.x + dx, tile.z + dz);
        if (neighbor >= 0) {
          const other = state.tiles[neighbor];
          parts.push(`${neighbor}g${other.elevation}:${other.kind}`);
        }
      }
  }
  return parts.join('|');
}
