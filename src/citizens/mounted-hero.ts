import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityState } from '../domain/types';
import { createPedestrianGraph, type PedestrianGraph } from './routing';
import { createDrivingCollisionWorld } from '../vehicles/collisions';
import { citizenSurfaceHeight } from './system';

// Historical tribute, not a simulated/saved citizen. Helmet reference:
// https://www.khm.at/en/exhibitions/imperial-armoury/skanderbeg
// Red cloak and dark armour are artistic choices, not a reconstruction claim.
const BODY = { halfWidth: 0.052, halfLength: 0.145, height: 0.37 };
const SPEED = 0.095;
const STRIDE = 0.065;
const UP = new THREE.Vector3(0, 1, 0);

export function createMountedHero(initialState: CityState) {
  const group = new THREE.Group();
  const model = new THREE.Group();
  group.add(model);
  const materials = [0x663c29, 0x241c20, 0x952636, 0x343e48, 0xc4a158, 0xd3ac87, 0xd7d4c6].map(
    (color, i) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: i === 4 ? 0.42 : 0.78,
        metalness: i === 3 || i === 4 ? 0.55 : 0,
      }),
  );
  const owned = new Set<THREE.BufferGeometry>();
  const buckets = materials.map(() => [] as THREE.BufferGeometry[]);
  function ellipsoid(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    material: number,
    tilt = 0,
  ) {
    const g = new THREE.SphereGeometry(1, 10, 7);
    g.scale(sx, sy, sz);
    g.rotateX(tilt);
    g.translate(x, y, z);
    buckets[material].push(g);
  }
  function curve(points: number[][], radius: number, material: number) {
    buckets[material].push(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(
          points.map((p) => new THREE.Vector3(...(p as [number, number, number]))),
        ),
        10,
        radius,
        5,
        false,
      ),
    );
  }
  // Barrel, haunches, chest, rising neck and long muzzle: rounded equine silhouette.
  ellipsoid(0, 0.148, -0.012, 0.039, 0.043, 0.077, 0);
  ellipsoid(0, 0.147, -0.064, 0.042, 0.045, 0.039, 0);
  ellipsoid(0, 0.156, 0.043, 0.035, 0.05, 0.037, 0);
  ellipsoid(0, 0.199, 0.068, 0.023, 0.061, 0.027, 0, -0.38);
  ellipsoid(0, 0.239, 0.093, 0.021, 0.028, 0.034, 0, -0.45);
  ellipsoid(0, 0.222, 0.117, 0.018, 0.018, 0.025, 0);
  for (const side of [-1, 1]) {
    ellipsoid(side * 0.014, 0.268, 0.08, 0.007, 0.02, 0.007, 0, -0.2);
    ellipsoid(side * 0.02, 0.245, 0.108, 0.003, 0.004, 0.004, 1);
    ellipsoid(side * 0.013, 0.22, 0.137, 0.004, 0.003, 0.002, 1);
    curve(
      [
        [side * 0.017, 0.231, 0.128],
        [side * 0.026, 0.229, 0.089],
        [side * 0.025, 0.237, 0.042],
        [side * 0.016, 0.257, 0.027],
      ],
      0.0016,
      1,
    );
  }
  curve(
    [
      [0, 0.255, 0.071],
      [0, 0.223, 0.041],
      [0, 0.179, 0.023],
    ],
    0.009,
    1,
  );
  curve(
    [
      [0, 0.161, -0.089],
      [0, 0.126, -0.112],
      [0.006, 0.068, -0.126],
    ],
    0.01,
    1,
  );
  ellipsoid(0, 0.189, -0.015, 0.043, 0.009, 0.046, 2); // saddle blanket
  ellipsoid(0, 0.197, -0.014, 0.029, 0.011, 0.03, 1);
  ellipsoid(0, 0.237, -0.009, 0.025, 0.039, 0.018, 3);
  ellipsoid(0, 0.284, -0.003, 0.016, 0.02, 0.016, 5);
  ellipsoid(0, 0.271, 0.01, 0.013, 0.012, 0.009, 6); // silver beard
  ellipsoid(0, 0.282, 0.018, 0.004, 0.006, 0.007, 5); // nose
  for (const side of [-1, 1]) ellipsoid(side * 0.007, 0.286, 0.014, 0.0025, 0.0025, 0.0025, 1);
  ellipsoid(0, 0.297, -0.005, 0.019, 0.017, 0.02, 3);
  curve(
    [
      [-0.018, 0.297, 0.006],
      [0, 0.297, 0.016],
      [0.018, 0.297, 0.006],
    ],
    0.003,
    4,
  );
  ellipsoid(0, 0.319, -0.002, 0.009, 0.012, 0.01, 4); // goat head
  ellipsoid(0, 0.316, 0.009, 0.006, 0.006, 0.011, 4);
  for (const side of [-1, 1]) {
    curve(
      [
        [side * 0.005, 0.325, -0.003],
        [side * 0.013, 0.345, -0.012],
        [side * 0.015, 0.339, -0.025],
      ],
      0.0028,
      4,
    );
    curve(
      [
        [side * 0.021, 0.259, -0.006],
        [side * 0.031, 0.237, 0.012],
        [side * 0.016, 0.257, 0.027],
      ],
      0.007,
      3,
    );
    curve(
      [
        [side * 0.019, 0.216, -0.012],
        [side * 0.042, 0.187, 0.008],
        [side * 0.039, 0.149, -0.001],
      ],
      0.008,
      3,
    );
    ellipsoid(side * 0.038, 0.146, 0.005, 0.009, 0.006, 0.016, 1);
    curve(
      [
        [side * 0.043, 0.161, -0.008],
        [side * 0.047, 0.14, -0.006],
        [side * 0.036, 0.138, 0.009],
      ],
      0.0017,
      4,
    );
  }
  // Curved, flared cloak, built as a single double-sided cloth surface.
  const cloakG = new THREE.PlaneGeometry(0.064, 0.105, 6, 8);
  const pos = cloakG.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = (0.0525 - pos.getY(i)) / 0.105,
      x = pos.getX(i) * (0.6 + v * 0.6);
    pos.setXYZ(i, x, 0.263 - v * 0.105, -0.018 - v * 0.095 + Math.cos(x * 140) * 0.003 * v);
  }
  cloakG.computeVertexNormals();
  materials[2].side = THREE.DoubleSide;
  buckets[2].push(cloakG);
  for (let i = 0; i < buckets.length; i++) {
    const g = mergeGeometries(buckets[i]);
    buckets[i].forEach((p) => p.dispose());
    if (g) {
      owned.add(g);
      const mesh = new THREE.Mesh(g, materials[i]);
      mesh.castShadow = true;
      model.add(mesh);
    }
  }
  const legGeometry = new THREE.CylinderGeometry(0.006, 0.0045, 1, 7);
  const hoofGeometry = new THREE.SphereGeometry(1, 8, 5);
  owned.add(legGeometry);
  owned.add(hoofGeometry);
  const legs = Array.from({ length: 4 }, (_, i) => {
    const upper = new THREE.Mesh(legGeometry, materials[0]),
      lower = new THREE.Mesh(legGeometry, materials[0]),
      hoof = new THREE.Mesh(hoofGeometry, materials[1]);
    model.add(upper, lower, hoof);
    upper.castShadow = lower.castShadow = hoof.castShadow = true;
    hoof.scale.set(0.009, 0.008, 0.013);
    return {
      upper,
      lower,
      hoof,
      x: i % 2 ? 0.026 : -0.026,
      z: i < 2 ? 0.05 : -0.061,
      phase: [0, 0.5, 0.75, 0.25][i],
      planted: true,
    };
  });
  function segment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.y = a.distanceTo(b);
    mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  }
  let state = initialState,
    graph: PedestrianGraph,
    signature = '',
    from: number | null = null,
    to: number | null = null,
    previous: number | null = null;
  let distance = 0,
    disposed = false,
    spawned = false;
  const collisions = createDrivingCollisionWorld(state);
  let legal = new Map<number, number[]>();
  function safe(x: number, z: number, yaw: number) {
    for (const dx of [-BODY.halfWidth, 0, BODY.halfWidth])
      for (const dz of [-BODY.halfLength, 0, BODY.halfLength]) {
        const px = x + dx * Math.cos(yaw) + dz * Math.sin(yaw),
          pz = z - dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const gx = Math.floor(px + state.size / 2),
          gz = Math.floor(pz + state.size / 2);
        if (gx < 0 || gz < 0 || gx >= state.size || gz >= state.size) return false;
        const tile = state.tiles[gz * state.size + gx];
        if (tile.kind === 'water' || tile.elevation < 0 || tile.fire > 0) return false;
      }
    return !collisions.collides(x, z, yaw, BODY, citizenSurfaceHeight(state, x, z));
  }
  function turnSafe(yaw: number) {
    const delta = Math.atan2(Math.sin(yaw - group.rotation.y), Math.cos(yaw - group.rotation.y));
    for (let i = 0; i <= 18; i++)
      if (!safe(group.position.x, group.position.z, group.rotation.y + (delta * i) / 18))
        return false;
    return true;
  }
  function choose() {
    if (from === null) return;
    const a = graph.byId.get(from)!;
    const options = [...(legal.get(from) ?? [])].sort(
      (a, b) => (a === previous ? 1 : 0) - (b === previous ? 1 : 0) || a - b,
    );
    to =
      options.find((id) => {
        const b = graph.byId.get(id)!;
        return turnSafe(Math.atan2(b.x - a.x, b.z - a.z));
      }) ?? null;
    if (to !== null) {
      const b = graph.byId.get(to)!;
      group.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    }
  }
  function pose(moving: boolean) {
    group.updateMatrixWorld(true);
    for (const leg of legs) {
      const t = (((distance / STRIDE + leg.phase) % 1) + 1) % 1;
      leg.planted = !moving || t < 0.75;
      const forward = moving
        ? t < 0.75
          ? ((0.375 - t) * STRIDE) / 0.75
          : ((-0.375 + (t - 0.75) * 3) * STRIDE) / 0.75
        : 0;
      const lift = leg.planted ? 0 : Math.sin(((t - 0.75) / 0.25) * Math.PI) * 0.022;
      const foot = new THREE.Vector3(leg.x, 0, leg.z + forward);
      // Terrain is in simulation coordinates. Gallery parents may scale/translate
      // the rendered group; those presentation transforms must not stretch legs.
      const yaw = group.rotation.y;
      const x = group.position.x + foot.x * Math.cos(yaw) + foot.z * Math.sin(yaw);
      const z = group.position.z - foot.x * Math.sin(yaw) + foot.z * Math.cos(yaw);
      foot.y = citizenSurfaceHeight(state, x, z) - group.position.y + lift + 0.008;
      const hip = new THREE.Vector3(leg.x, 0.139, leg.z);
      const knee = hip.clone().lerp(foot, 0.51);
      knee.z += (leg.z > 0 ? -0.012 : 0.018) + lift * 0.6;
      segment(leg.upper, hip, knee);
      segment(leg.lower, knee, foot);
      leg.hoof.position.copy(foot);
    }
  }
  function update(next: CityState) {
    if (disposed) return;
    state = next;
    collisions.setState(state);
    const nextSignature = JSON.stringify([
      state.size,
      state.tiles.map((t) => [t.kind, t.elevation, t.level, t.fire, t.variation, t.anchor]),
    ]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    // Road pavement only: park interiors need horse-specific furnishing clearance.
    const roads = state.tiles.flatMap((t, i) => (t.kind === 'road' ? [i] : []));
    const score = (index: number) => {
      const tile = state.tiles[index];
      let score = -Math.hypot(tile.x - state.size / 2, tile.z - state.size / 2) * 0.15;
      for (let z = Math.max(0, tile.z - 2); z <= Math.min(state.size - 1, tile.z + 2); z++)
        for (let x = Math.max(0, tile.x - 2); x <= Math.min(state.size - 1, tile.x + 2); x++) {
          const t = state.tiles[z * state.size + x];
          score +=
            t.kind === 'park'
              ? 5
              : ['residential', 'commercial'].includes(t.kind) && t.level > 0
                ? 3
                : 0;
        }
      return score;
    };
    roads.sort((a, b) => score(b) - score(a) || a - b);
    const centre = roads.length ? state.tiles[roads[0]] : null;
    const active = roads.filter(
      (i) =>
        centre &&
        Math.abs(state.tiles[i].x - centre.x) <= 12 &&
        Math.abs(state.tiles[i].z - centre.z) <= 12,
    );
    graph = createPedestrianGraph(state, active);
    legal = new Map();
    for (const a of graph.nodes) {
      const edges = graph
        .neighbors(a.id)
        .filter((e) => {
          const b = graph.byId.get(e.node)!,
            length = Math.hypot(b.x - a.x, b.z - a.z),
            yaw = Math.atan2(b.x - a.x, b.z - a.z);
          const steps = Math.ceil(length / 0.025);
          for (let i = 0; i <= steps; i++)
            if (!safe(a.x + ((b.x - a.x) * i) / steps, a.z + ((b.z - a.z) * i) / steps, yaw))
              return false;
          return true;
        })
        .map((e) => e.node);
      legal.set(a.id, edges);
    }
    if (spawned) {
      // Never snap to a replacement route after demolition; hide until this edge returns.
      const a = from === null ? undefined : graph.byId.get(from);
      const b = to === null ? a : graph.byId.get(to);
      const onEdge =
        a &&
        b &&
        Math.abs(
          Math.hypot(group.position.x - a.x, group.position.z - a.z) +
            Math.hypot(group.position.x - b.x, group.position.z - b.z) -
            Math.hypot(b.x - a.x, b.z - a.z),
        ) < 1e-7;
      group.visible =
        !!onEdge &&
        from !== null &&
        graph.byId.has(from) &&
        (to === null || (legal.get(from) ?? []).includes(to)) &&
        safe(group.position.x, group.position.z, group.rotation.y);
      if (group.visible && to === null) choose();
    } else {
      const candidates = graph.nodes
        .filter((n) => (legal.get(n.id)?.length ?? 0) > 0)
        .sort((a, b) => score(b.tile) - score(a.tile) || a.id - b.id);
      group.visible = false;
      for (const node of candidates) {
        from = node.id;
        group.position.set(node.x, citizenSurfaceHeight(state, node.x, node.z), node.z);
        const target = graph.byId.get(legal.get(from)![0])!;
        group.rotation.y = Math.atan2(target.x - node.x, target.z - node.z);
        choose();
        if (to !== null) {
          spawned = true;
          group.visible = true;
          break;
        }
      }
    }
    pose(false);
  }
  function animate(dt: number, walking: boolean) {
    if (
      disposed ||
      !group.visible ||
      !walking ||
      state.speed === 0 ||
      !Number.isFinite(dt) ||
      dt <= 0
    )
      return;
    let travel = Math.min(dt, 0.1) * SPEED;
    while (travel > 1e-9 && to !== null) {
      const target = graph.byId.get(to)!;
      const remaining = Math.hypot(target.x - group.position.x, target.z - group.position.z),
        step = Math.min(travel, remaining);
      if (remaining > 1e-9) {
        group.position.x += ((target.x - group.position.x) * step) / remaining;
        group.position.z += ((target.z - group.position.z) * step) / remaining;
      }
      distance += step;
      travel -= step;
      group.position.y = citizenSurfaceHeight(state, group.position.x, group.position.z);
      if (remaining <= step + 1e-9) {
        previous = from;
        from = to;
        choose();
      }
    }
    pose(to !== null);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    collisions.dispose();
    owned.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    group.clear();
    group.removeFromParent();
    group.visible = false;
  }
  update(initialState);
  return {
    group,
    update,
    animate,
    dispose,
    getDebug: () => ({
      id: 'skanderbeg',
      visible: group.visible,
      disposed,
      from,
      to,
      distance,
      position: group.position.toArray(),
      graphNodes: graph.nodes.length,
      routeEdges: [...legal].flatMap(([a, bs]) => bs.map((b) => [a, b])),
      feet: legs.map((l) => ({ position: l.hoof.position.toArray(), planted: l.planted })),
      meshCount: 7 + legs.length * 3,
      triangles: model.children.reduce((n, object) => {
        const g = (object as THREE.Mesh).geometry;
        return n + (g.index?.count ?? g.attributes.position.count) / 3;
      }, 0),
    }),
  };
}
