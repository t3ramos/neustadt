import type { CityState, Point } from '../../domain/types';

const STEPS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;
/** Input is tile coordinates; output is a closed path in centred WORLD coordinates.
 * Every traversed centre has a 3×3 patch of actual water (bridges excluded),
 * leaving ample room for a turning sailboat hull and avoiding sloping shorelines.
 */
export function routeForWaterBody(
  state: CityState,
  startX: number,
  startZ: number,
  maxSteps = 64,
): Point[] {
  const n = state.size;
  const safe = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx,
          zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= n || zz >= n) return false;
        const t = state.tiles[zz * n + xx];
        if (t.kind !== 'water' || t.elevation >= 0) return false;
      }
    return true;
  };
  if (!Number.isInteger(startX) || !Number.isInteger(startZ) || !safe(startX, startZ)) return [];
  const start = startZ * n + startX,
    visited = new Set<number>([start]),
    route = [start],
    stack = [{ i: start, d: 0 }],
    limit = Math.max(2, Math.min(256, Math.floor(maxSteps)));
  while (stack.length && visited.size < limit) {
    const node = stack[stack.length - 1];
    if (node.d === 4) {
      stack.pop();
      if (stack.length) route.push(stack[stack.length - 1].i);
      continue;
    }
    const [dx, dz] = STEPS[node.d++],
      x = (node.i % n) + dx,
      z = Math.floor(node.i / n) + dz,
      i = z * n + x;
    if (visited.has(i) || !safe(x, z)) continue;
    visited.add(i);
    route.push(i);
    stack.push({ i, d: 0 });
  }
  while (stack.length > 1) {
    stack.pop();
    route.push(stack[stack.length - 1].i);
  }
  if (route.length < 3) return [];
  return route.map((i) => ({ x: (i % n) + 0.5 - n / 2, z: Math.floor(i / n) + 0.5 - n / 2 }));
}

/** Distance is world tiles along the unit-length cardinal edges; heading faces local +Z. */
export function sampleWaterRoute(
  route: readonly Point[],
  distance: number,
): Point & { heading: number } {
  if (!route.length) return { x: 0, z: 0, heading: 0 };
  if (route.length === 1) return { ...route[0], heading: 0 };
  const length = route.length - 1,
    wrapped = ((distance % length) + length) % length,
    index = Math.floor(wrapped),
    f = wrapped - index,
    p = route[index],
    q = route[index + 1];
  return {
    x: p.x + (q.x - p.x) * f,
    z: p.z + (q.z - p.z) * f,
    heading: Math.atan2(q.x - p.x, q.z - p.z),
  };
}
