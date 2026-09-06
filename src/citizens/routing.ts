import type { CityState, Tile } from '../domain/types';

/** Walking line on the .165-wide pavement outside the .67-wide carriageway. */
export const SIDEWALK_OFFSET = 0.405;
export const PARK_PATH_END = 0.46;

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

export interface PedestrianObstacles {
  /** Actual model collision at an adult pedestrian's foot/torso height. Called
   * only while building the graph; normal walking does not query model meshes. */
  blocked(tileIndex: number, x: number, z: number): boolean;
}

export interface PedestrianGraph {
  readonly nodes: readonly PedestrianNode[];
  readonly byId: ReadonlyMap<number, PedestrianNode>;
  neighbors(id: number): readonly PedestrianEdge[];
  /** Exact nearest node; an equally close preferred node avoids side changes. */
  nearest(x: number, z: number, preferredId?: number): number | null;
}

const EMPTY_EDGES: readonly PedestrianEdge[] = [];
const DIRECTIONS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
const EDGE_CORNERS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
] as const;
const MAX_STEP = 0.75;
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
    point: sorted[middle],
    axis,
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
  obstacles?: PedestrianObstacles,
): PedestrianGraph {
  const nodes: PedestrianNode[] = [];
  const byId = new Map<number, PedestrianNode>();
  const edges = new Map<number, PedestrianEdge[]>();
  const tiles = new Map<number, Tile>();
  const marked = new Set<number>();
  const origin = 0.5 - state.size / 2;

  function adjacent(tile: Tile, direction: number): number | null {
    const [dx, dz] = DIRECTIONS[direction],
      x = tile.x + dx,
      z = tile.z + dz;
    return x >= 0 && z >= 0 && x < state.size && z < state.size ? z * state.size + x : null;
  }
  function addNode(
    tileIndex: number,
    slot: number,
    dx: number,
    dz: number,
    idOverride?: number,
  ): void {
    const tile = tiles.get(tileIndex)!;
    const point = {
      id: idOverride ?? tileIndex * 8 + slot,
      tile: tileIndex,
      x: tile.x + origin + dx,
      z: tile.z + origin + dz,
    };
    if (byId.has(point.id)) return;
    nodes.push(point);
    byId.set(point.id, point);
    edges.set(point.id, []);
  }
  const obstacleSamples = new Map<string, boolean>();
  function blocked(x: number, z: number): boolean {
    if (!obstacles) return false;
    const gx = Math.floor(x + state.size / 2),
      gz = Math.floor(z + state.size / 2),
      tile = gz * state.size + gx;
    if (gx < 0 || gz < 0 || gx >= state.size || gz >= state.size) return true;
    const key = `${tile}:${x.toFixed(5)}:${z.toFixed(5)}`;
    let value = obstacleSamples.get(key);
    if (value === undefined) {
      value = obstacles.blocked(tile, x, z);
      obstacleSamples.set(key, value);
    }
    return value;
  }
  function segmentClear(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    if (!obstacles) return true;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.025));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      if (blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }
  function connect(a: number, b: number, crosswalk = false): void {
    if (!byId.has(a) || !byId.has(b) || a === b) return;
    if (!segmentClear(byId.get(a)!, byId.get(b)!)) return;
    if (!edges.get(a)!.some((edge) => edge.node === b)) {
      edges.get(a)!.push({ node: b, crosswalk });
      edges.get(b)!.push({ node: a, crosswalk });
    }
  }
  function reachable(a: Tile, b: Tile | undefined): b is Tile {
    return !!b && Math.abs(a.elevation - b.elevation) <= MAX_STEP;
  }

  for (const index of [...new Set(activeTileIndices)].sort((a, b) => a - b)) {
    const tile = state.tiles[index];
    if (
      !Number.isInteger(index) ||
      !tile ||
      (tile.kind !== 'road' && tile.kind !== 'park') ||
      tile.fire > 0 ||
      !Number.isFinite(tile.elevation) ||
      tile.elevation < 0
    )
      continue;
    tiles.set(index, tile);
  }

  for (const [index, tile] of tiles) {
    if (tile.kind === 'park') {
      if (!obstacles) {
        addNode(index, 0, 0, 0);
        for (let side = 0; side < 4; side++) {
          const [dx, dz] = DIRECTIONS[side];
          addNode(index, side + 4, dx * PARK_PATH_END, dz * PARK_PATH_END);
          connect(index * 8, index * 8 + side + 4);
        }
      } else {
        // Route around fountains, benches, raised beds and trunks. A small
        // occupancy grid is temporary: only compressed, straight waypoints
        // enter the walking graph, so people do not jitter at every grid cell.
        const edge = 17,
          last = edge - 1,
          mid = last / 2;
        const location = (cell: number) => ({
          x: tile.x + origin - PARK_PATH_END + ((cell % edge) * PARK_PATH_END * 2) / last,
          z: tile.z + origin - PARK_PATH_END + (Math.floor(cell / edge) * PARK_PATH_END * 2) / last,
        });
        const open = Array.from({ length: edge * edge }, (_, cell) => {
          const p = location(cell);
          return !blocked(p.x, p.z);
        });
        const ports = [mid, mid * edge + last, last * edge + mid, mid * edge, mid * edge + mid];
        const nodeId = (cell: number) => {
          const port = ports.indexOf(cell);
          return port >= 0 ? index * 8 + (port === 4 ? 0 : port + 4) : -(index * 512 + cell + 1);
        };
        const addCell = (cell: number) => {
          const p = location(cell);
          addNode(index, 0, p.x - tile.x - origin, p.z - tile.z - origin, nodeId(cell));
        };
        for (const port of ports) if (open[port]) addCell(port);
        for (let from = 0; from < ports.length; from++)
          for (let to = from + 1; to < ports.length; to++) {
            const start = ports[from],
              goal = ports[to];
            if (!open[start] || !open[goal]) continue;
            const previous = new Int32Array(edge * edge).fill(-1),
              queue = [start];
            previous[start] = start;
            for (let cursor = 0; cursor < queue.length && previous[goal] < 0; cursor++) {
              const cell = queue[cursor],
                x = cell % edge,
                z = Math.floor(cell / edge);
              for (const [dx, dz] of DIRECTIONS) {
                const nx = x + dx,
                  nz = z + dz,
                  next = nz * edge + nx;
                if (
                  nx < 0 ||
                  nz < 0 ||
                  nx >= edge ||
                  nz >= edge ||
                  !open[next] ||
                  previous[next] >= 0
                )
                  continue;
                if (!segmentClear(location(cell), location(next))) continue;
                previous[next] = cell;
                queue.push(next);
              }
            }
            if (previous[goal] < 0) continue;
            const path = [goal];
            while (path.at(-1) !== start) path.push(previous[path.at(-1)!]);
            path.reverse();
            let anchor = path[0];
            addCell(anchor);
            for (let i = 1; i < path.length; i++) {
              if (i < path.length - 1 && path[i] - path[i - 1] === path[i + 1] - path[i]) continue;
              addCell(path[i]);
              connect(nodeId(anchor), nodeId(path[i]));
              anchor = path[i];
            }
          }
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
    if (count === 0) {
      arms[0] = true;
      arms[2] = true;
    }
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
      const [a, b] = EDGE_CORNERS[side],
        port = index * 8 + side + 4;
      const crosswalk = arms[side] && marked.has(index);
      if (byId.has(port)) {
        connect(index * 8 + a, port, crosswalk);
        connect(port, index * 8 + b, crosswalk);
      } else connect(index * 8 + a, index * 8 + b, crosswalk);
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
        const [a, b] = EDGE_CORNERS[side],
          [c, d] = EDGE_CORNERS[opposite];
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
    nodes,
    byId,
    neighbors(id) {
      return edges.get(id) ?? EMPTY_EDGES;
    },
    nearest(x, z, preferredId) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      let best = preferredId === undefined ? undefined : byId.get(preferredId);
      let distance = best ? (best.x - x) ** 2 + (best.z - z) ** 2 : Infinity;
      function search(branch: SpatialNode | null): void {
        if (!branch) return;
        const point = branch.point,
          candidate = (point.x - x) ** 2 + (point.z - z) ** 2;
        if (
          candidate < distance - DISTANCE_EPSILON ||
          (Math.abs(candidate - distance) <= DISTANCE_EPSILON &&
            best?.id !== preferredId &&
            (!best || point.id < best.id))
        ) {
          best = point;
          distance = candidate;
        }
        const delta = (branch.axis === 'x' ? x : z) - point[branch.axis];
        search(delta < 0 ? branch.left : branch.right);
        if (delta * delta <= distance + DISTANCE_EPSILON)
          search(delta < 0 ? branch.right : branch.left);
      }
      search(tree);
      return best?.id ?? null;
    },
  };
}
