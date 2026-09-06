import * as THREE from 'three';
import type { CityState, Point } from '../../domain/types';
import { box, cylinder, mesh, sphereGeometry } from '../buildings/primitives';
import { modelMaterial } from '../buildings/materials';

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
/** Cardinal cell-centre paths retain at least half a tile of clearance from dry cells. */
export function recreationRoute(state: CityState): Point[] {
  const n = state.size,
    wet = new Set(
      state.tiles.flatMap((t, i) => (t.kind === 'water' && t.elevation < 0 ? [i] : [])),
    ),
    seen = new Set<number>();
  const bodies: Array<{ cells: number[]; score: number }> = [];
  for (const start of wet) {
    if (seen.has(start)) continue;
    const cells = [start];
    seen.add(start);
    let score = 0;
    for (let q = 0; q < cells.length; q++) {
      const i = cells[q],
        x = i % n,
        z = Math.floor(i / n);
      for (const [dx, dz] of DIRECTIONS) {
        const nx = x + dx,
          nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const j = nz * n + nx;
        if (wet.has(j) && !seen.has(j)) {
          seen.add(j);
          cells.push(j);
        } else if (state.tiles[j].kind === 'park') score += 8;
        else if (state.tiles[j].kind === 'residential') score++;
      }
    }
    if (cells.length >= 20)
      bodies.push({ cells, score: score / cells.length + (cells.length < n * n * 0.1 ? 1 : 0) });
  }
  bodies.sort((a, b) => b.score - a.score || a.cells.length - b.cells.length);
  if (!bodies.length) return [];
  const allowed = new Set(bodies[0].cells),
    start = bodies[0].cells[Math.floor(bodies[0].cells.length / 2)],
    visited = new Set<number>([start]),
    route: number[] = [start];
  // Bounded DFS walk, including return edges: no diagonal shortcuts or cross-shore interpolation.
  const stack = [{ i: start, d: 0 }];
  while (stack.length && visited.size < 48) {
    const node = stack[stack.length - 1];
    if (node.d === 4) {
      stack.pop();
      if (stack.length) route.push(stack[stack.length - 1].i);
      continue;
    }
    const [dx, dz] = DIRECTIONS[node.d++],
      x = (node.i % n) + dx,
      z = Math.floor(node.i / n) + dz,
      j = z * n + x;
    if (x < 0 || z < 0 || x >= n || z >= n || !allowed.has(j) || visited.has(j)) continue;
    visited.add(j);
    route.push(j);
    stack.push({ i: j, d: 0 });
  }
  while (stack.length > 1) {
    stack.pop();
    route.push(stack[stack.length - 1].i);
  }
  return route.map((i) => ({ x: (i % n) + 0.5 - n / 2, z: Math.floor(i / n) + 0.5 - n / 2 }));
}
function person(g: THREE.Group, seated = false) {
  const y = seated ? 0.115 : 0.1;
  for (const x of [-0.025, 0.025]) box(g, 0x253c49, x, y + 0.045, 0, 0.033, 0.09, 0.035);
  box(g, 0xe17442, 0, y + 0.115, 0, 0.087, 0.09, 0.05);
  mesh(g, sphereGeometry, 0xd9ab83, 0, y + 0.185, 0, 0.065, 0.065, 0.065);
  box(g, 0xd9ab83, 0.06, y + 0.11, 0.015, 0.06, 0.023, 0.023);
}
function surfer(color: number) {
  const g = new THREE.Group();
  g.name = 'windsurfer';
  const board = mesh(g, sphereGeometry, color, 0, 0.012, 0, 0.14, 0.045, 0.44);
  board.castShadow = true;
  person(g);
  cylinder(g, 0xeee4ca, 0.025, 0.24, -0.065, 0.013, 0.46);
  const sail = new THREE.BufferGeometry();
  sail.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0.027, 0.45, -0.06, 0.027, 0.12, -0.06, 0.027, 0.15, 0.2], 3),
  );
  sail.computeVertexNormals();
  const material = modelMaterial(color).clone();
  material.side = THREE.DoubleSide;
  const sailMesh = new THREE.Mesh(sail, material);
  sailMesh.name = 'recreation-owned-sail';
  g.add(sailMesh);
  return g;
}
function rowboat() {
  const g = new THREE.Group();
  g.name = 'small-rowboat';
  box(g, 0x8e593a, 0, 0.025, 0, 0.22, 0.045, 0.43);
  for (const x of [-0.12, 0.12]) box(g, 0xb67d4d, x, 0.07, 0, 0.035, 0.09, 0.43);
  for (const z of [-0.21, 0.21]) box(g, 0xb67d4d, 0, 0.065, z, 0.23, 0.08, 0.025);
  box(g, 0xc49a69, 0, 0.085, 0, 0.24, 0.035, 0.085);
  person(g, true);
  const paddles: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const p = new THREE.Group();
    p.position.set(side * 0.1, 0.12, 0);
    box(p, 0x9a724a, side * 0.095, 0, 0, 0.21, 0.016, 0.018);
    box(p, 0xc3a06c, side * 0.16, 0, 0, 0.075, 0.02, 0.046);
    g.add(p);
    paddles.push(p);
  }
  return { g, paddles };
}
export function createWaterRecreation(initial: CityState) {
  const group = new THREE.Group();
  group.name = 'water-recreation';
  let route: Point[] = [],
    signature = '',
    travel = 0;
  const boat = rowboat(),
    actors = [surfer(0xed7042), surfer(0xead062), surfer(0x63b5bc), boat.g];
  for (const a of actors) group.add(a);
  const update = (state: CityState) => {
    const next =
      `${state.size}:` +
      state.tiles
        .map((t) =>
          t.kind === 'water' && t.elevation < 0
            ? 'w'
            : t.kind === 'park'
              ? 'p'
              : t.kind === 'residential'
                ? 'r'
                : '.',
        )
        .join('');
    if (next === signature) return;
    signature = next;
    route = recreationRoute(state);
    group.visible = route.length > 1;
    position(0);
  };
  function position(elapsed: number) {
    if (route.length < 2) return;
    const edges = route.length - 1;
    actors.forEach((a, i) => {
      const progress = (travel + (i * edges) / actors.length) % edges,
        index = Math.floor(progress),
        f = progress - index,
        p = route[index],
        q = route[index + 1];
      a.position.set(
        p.x + (q.x - p.x) * f,
        -0.055 + Math.sin(elapsed * 1.8 + i) * 0.004,
        p.z + (q.z - p.z) * f,
      );
      a.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
    });
    for (let i = 0; i < boat.paddles.length; i++)
      boat.paddles[i].rotation.y = Math.sin(elapsed * 2.2) * (i === 0 ? 1 : -1) * 0.45;
  }
  update(initial);
  return {
    group,
    update,
    animate(dt: number, elapsed: number, speed: number) {
      if (speed > 0) travel += Math.min(dt, 0.1) * 0.15 * speed;
      position(speed > 0 ? elapsed : travel);
    },
    getDebug: () => ({
      actorCount: group.visible ? 4 : 0,
      surfers: group.visible ? 3 : 0,
      rowboats: group.visible ? 1 : 0,
      routeCells: route.length,
      positions: actors.map((a) => ({ x: a.position.x, z: a.position.z })),
    }),
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name === 'recreation-owned-sail') {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      group.clear();
    },
  };
}
