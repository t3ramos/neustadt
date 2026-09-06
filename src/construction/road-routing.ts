import type { CityState, Point } from '../domain/types';

const directions = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;
const traversable = new Set(['empty', 'tree', 'rubble', 'water', 'road']);
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

interface Node {
  id: number;
  cost: number;
  priority: number;
  order: number;
}

/** Stable binary heap keeps a full-map drag practical without sorting the open set. */
class Frontier {
  private nodes: Node[] = [];
  private before(a: Node, b: Node): boolean {
    return a.priority < b.priority || (a.priority === b.priority && a.order < b.order);
  }
  push(node: Node): void {
    let i = this.nodes.length;
    this.nodes.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(node, this.nodes[parent])) break;
      this.nodes[i] = this.nodes[parent];
      i = parent;
    }
    this.nodes[i] = node;
  }
  pop(): Node | undefined {
    const first = this.nodes[0],
      last = this.nodes.pop();
    if (!this.nodes.length || !last) return first;
    let i = 0;
    while (i * 2 + 1 < this.nodes.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.nodes.length && this.before(this.nodes[child + 1], this.nodes[child]))
        child++;
      if (!this.before(this.nodes[child], last)) break;
      this.nodes[i] = this.nodes[child];
      i = child;
    }
    this.nodes[i] = last;
    return first;
  }
}

/** Anchor-to-pointer routing protects every zoned/occupied tile, even undeveloped lots.
 * Water remains bridge-buildable, but is more expensive than dry ground. A blocked
 * endpoint snaps only to its nearest free boundary; a blocked anchor never moves.
 */
export function routeRoad(state: CityState, start: Point, pointer: Point): Point[] {
  const size = state.size;
  const inBounds = (p: Point) =>
    Number.isInteger(p.x) &&
    Number.isInteger(p.z) &&
    p.x >= 0 &&
    p.z >= 0 &&
    p.x < size &&
    p.z < size;
  if (!inBounds(start) || !inBounds(pointer)) return [];
  const safe = (p: Point) => {
    if (!inBounds(p)) return false;
    const tile = state.tiles[p.z * size + p.x];
    const owner = tile.anchor >= 0 ? state.tiles[tile.anchor] : undefined;
    return traversable.has(tile.kind) && (!owner || traversable.has(owner.kind));
  };
  if (!safe(start)) return [];
  const goals: Point[] = [];
  if (safe(pointer)) goals.push(pointer);
  else {
    // Never silently jump farther than a large lot's nearby perimeter.
    for (let radius = 1; radius <= 24 && !goals.length; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dz = radius - Math.abs(dx);
        for (const sign of dz ? [-1, 1] : [1]) {
          const p = { x: pointer.x + dx, z: pointer.z + dz * sign };
          if (safe(p)) goals.push(p);
        }
      }
    }
  }
  if (!goals.length) return [];
  const targetIds = new Set(goals.map((p) => p.z * size + p.x));
  const heuristic = (p: Point) => Math.min(...goals.map((g) => distance(p, g))) * 10;
  const direct = distance(start, pointer),
    margin = Math.min(32, Math.max(8, direct));
  const maxCost = (direct + margin * 2 + 1) * 14;
  const x0 = Math.max(0, Math.min(start.x, pointer.x) - margin),
    x1 = Math.min(size - 1, Math.max(start.x, pointer.x) + margin);
  const z0 = Math.max(0, Math.min(start.z, pointer.z) - margin),
    z1 = Math.min(size - 1, Math.max(start.z, pointer.z) + margin);
  const costs = new Float64Array(size * size * 4).fill(Infinity);
  const parents = new Int32Array(costs.length).fill(-1);
  const frontier = new Frontier();
  let order = 0;
  for (let dir = 0; dir < 4; dir++) {
    const id = (start.z * size + start.x) * 4 + dir;
    costs[id] = 0;
    frontier.push({ id, cost: 0, priority: heuristic(start), order: order++ });
  }
  for (let node = frontier.pop(); node; node = frontier.pop()) {
    if (node.cost !== costs[node.id]) continue;
    const cell = node.id >> 2,
      p = { x: cell % size, z: Math.floor(cell / size) };
    if (targetIds.has(cell)) {
      const path: Point[] = [];
      for (let id = node.id; id >= 0; id = parents[id]) {
        const c = id >> 2;
        path.push({ x: c % size, z: Math.floor(c / size) });
      }
      return path.reverse();
    }
    for (let dir = 0; dir < 4; dir++) {
      const [dx, dz] = directions[dir],
        next = { x: p.x + dx, z: p.z + dz };
      if (next.x < x0 || next.x > x1 || next.z < z0 || next.z > z1 || !safe(next)) continue;
      const cellId = next.z * size + next.x,
        tile = state.tiles[cellId];
      const cost =
        node.cost +
        10 +
        (dir === (node.id & 3) ? 0 : 3) +
        (tile.elevation < 0 && tile.kind !== 'road' ? 4 : 0);
      const id = cellId * 4 + dir,
        priority = cost + heuristic(next);
      if (cost >= costs[id] || priority > maxCost) continue;
      costs[id] = cost;
      parents[id] = node.id;
      frontier.push({ id, cost, priority, order: order++ });
    }
  }
  return [];
}
