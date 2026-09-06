import type { CityState, Tile } from './types';

/** Walking line on the .165-wide pavement outside the .67-wide carriageway. */
export const SIDEWALK_OFFSET = .405;
export const PARK_PATH_END = .46;

export interface PedestrianNode {
  readonly id: number;
  readonly tile: number;
  /** World coordinates, including the map's centred origin. */
  readonly x: number;
  readonly z: number;
}

export interface PedestrianEdge {
  readonly node: number;
  readonly crosswalk: boolean;
}

export interface PedestrianGraph {
  readonly nodes: readonly PedestrianNode[];
  readonly byId: ReadonlyMap<number, PedestrianNode>;
  neighbors(id: number): readonly PedestrianEdge[];
  /** Exact nearest node; an equally close preferred node avoids side changes. */
  nearest(x: number, z: number, preferredId?: number): number | null;
}

const EMPTY_EDGES: readonly PedestrianEdge[] = [];
const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const EDGE_CORNERS = [[0, 1], [1, 2], [2, 3], [3, 0]] as const;
const MAX_STEP = .75;
const DISTANCE_EPSILON = 1e-12;

interface SpatialNode {
  point: PedestrianNode;
  axis: 'x' | 'z';
  left: SpatialNode | null;
  right: SpatialNode | null;
}

function spatialIndex(points: readonly PedestrianNode[], depth = 0): SpatialNode | null {
  if (!points.length) return null;
  const axis = depth % 2 ? 'z' : 'x';
  const sorted = [...points].sort((a, b) => a[axis] - b[axis] || a.id - b.id);
  const middle = Math.floor(sorted.length / 2);
  return {
    point: sorted[middle], axis,
    left: spatialIndex(sorted.slice(0, middle), depth + 1),
    right: spatialIndex(sorted.slice(middle + 1), depth + 1),
  };
}

/**
 * Four permanent corner nodes per road tile follow the rendered pavement.
 * Road ports 4..7 are created only where a park entrance splits a pavement edge.
 * Parks use their centre (0) and four path ends (4 N, 5 E, 6 S, 7 W).
 * Neighbouring roads join matching corners across the .19-wide tile seam.
 */
export function createPedestrianGraph(
  state: CityState,
  activeTileIndices: ReadonlySet<number> | readonly number[],
): PedestrianGraph {
  const nodes: PedestrianNode[] = [];
  const byId = new Map<number, PedestrianNode>();
  const edges = new Map<number, PedestrianEdge[]>();
  const tiles = new Map<number, Tile>();
  const marked = new Set<number>();
  const origin = .5 - state.size / 2;

  function adjacent(tile: Tile, direction: number): number | null {
    const [dx, dz] = DIRECTIONS[direction], x = tile.x + dx, z = tile.z + dz;
    return x >= 0 && z >= 0 && x < state.size && z < state.size ? z * state.size + x : null;
  }
  function addNode(tileIndex: number, slot: number, dx: number, dz: number): void {
    const tile = tiles.get(tileIndex)!;
    const point = { id: tileIndex * 8 + slot, tile: tileIndex, x: tile.x + origin + dx, z: tile.z + origin + dz };
    nodes.push(point); byId.set(point.id, point); edges.set(point.id, []);
  }
  function connect(a: number, b: number, crosswalk = false): void {
    if (!byId.has(a) || !byId.has(b) || a === b) return;
    if (!edges.get(a)!.some(edge => edge.node === b)) {
      edges.get(a)!.push({ node: b, crosswalk });
      edges.get(b)!.push({ node: a, crosswalk });
    }
  }
  function reachable(a: Tile, b: Tile | undefined): b is Tile {
    return !!b && Math.abs(a.elevation - b.elevation) <= MAX_STEP;
  }

  for (const index of [...new Set(activeTileIndices)].sort((a, b) => a - b)) {
    const tile = state.tiles[index];
    if (!Number.isInteger(index) || !tile || (tile.kind !== 'road' && tile.kind !== 'park') || tile.fire > 0 || !Number.isFinite(tile.elevation) || tile.elevation < 0) continue;
    tiles.set(index, tile);
  }

  for (const [index, tile] of tiles) {
    if (tile.kind === 'park') {
      addNode(index, 0, 0, 0);
      for (let side = 0; side < 4; side++) {
        const [dx, dz] = DIRECTIONS[side];
        addNode(index, side + 4, dx * PARK_PATH_END, dz * PARK_PATH_END);
        connect(index * 8, index * 8 + side + 4);
      }
      continue;
    }
    const arms = DIRECTIONS.map((_, side) => {
      const other = adjacent(tile, side);
      return other !== null && ['road', 'airport', 'seaport'].includes(state.tiles[other]?.kind);
    });
    const count = arms.filter(Boolean).length;
    if (count >= 3) marked.add(index);
    // An isolated road is rendered with north/south asphalt arms as well.
    if (count === 0) { arms[0] = true; arms[2] = true; }
    for (let corner = 0; corner < 4; corner++) {
      const [dx, dz] = CORNERS[corner];
      addNode(index, corner, dx * SIDEWALK_OFFSET, dz * SIDEWALK_OFFSET);
    }
    for (let side = 0; side < 4; side++) {
      if (arms[side] && !marked.has(index)) continue;
      const neighborIndex = adjacent(tile, side);
      const neighbor = neighborIndex === null ? undefined : tiles.get(neighborIndex);
      if (neighbor?.kind === 'park' && reachable(tile, neighbor)) {
        const [dx, dz] = DIRECTIONS[side];
        addNode(index, side + 4, dx * SIDEWALK_OFFSET, dz * SIDEWALK_OFFSET);
      }
      const [a, b] = EDGE_CORNERS[side], port = index * 8 + side + 4;
      const crosswalk = arms[side] && marked.has(index);
      if (byId.has(port)) { connect(index * 8 + a, port, crosswalk); connect(port, index * 8 + b, crosswalk); }
      else connect(index * 8 + a, index * 8 + b, crosswalk);
    }
  }

  for (const [index, tile] of tiles) {
    for (let side = 0; side < 4; side++) {
      const neighborIndex = adjacent(tile, side);
      if (neighborIndex === null || neighborIndex < index) continue;
      const neighbor = tiles.get(neighborIndex);
      if (!reachable(tile, neighbor)) continue;
      const opposite = (side + 2) % 4;
      if (tile.kind === 'road' && neighbor.kind === 'road') {
        const [a, b] = EDGE_CORNERS[side], [c, d] = EDGE_CORNERS[opposite];
        connect(index * 8 + a, neighborIndex * 8 + d);
        connect(index * 8 + b, neighborIndex * 8 + c);
      } else {
        // Park ports line up perpendicular to the pavement; no diagonal shortcut.
        connect(index * 8 + side + 4, neighborIndex * 8 + opposite + 4);
      }
    }
  }

  const tree = spatialIndex(nodes);
  return {
    nodes, byId,
    neighbors(id) { return edges.get(id) ?? EMPTY_EDGES; },
    nearest(x, z, preferredId) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      let best = preferredId === undefined ? undefined : byId.get(preferredId);
      let distance = best ? (best.x - x) ** 2 + (best.z - z) ** 2 : Infinity;
      function search(branch: SpatialNode | null): void {
        if (!branch) return;
        const point = branch.point, candidate = (point.x - x) ** 2 + (point.z - z) ** 2;
        if (candidate < distance - DISTANCE_EPSILON || (Math.abs(candidate - distance) <= DISTANCE_EPSILON && best?.id !== preferredId && (!best || point.id < best.id))) {
          best = point; distance = candidate;
        }
        const delta = (branch.axis === 'x' ? x : z) - point[branch.axis];
        search(delta < 0 ? branch.left : branch.right);
        if (delta * delta <= distance + DISTANCE_EPSILON) search(delta < 0 ? branch.right : branch.left);
      }
      search(tree);
      return best?.id ?? null;
    },
  };
}
