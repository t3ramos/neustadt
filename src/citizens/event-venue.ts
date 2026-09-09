import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityState } from '../domain/types';
import { createTileModel } from '../rendering/buildings/models';
import { sampleGroundHeight } from '../rendering/world/terrain';

type Event = { kind: 'gathering' | 'festival'; x: number; z: number };
type Placement = { name: string; x: number; z: number; width: number; depth: number; tile: number };
const owned = new WeakMap<
  THREE.Group,
  { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material> }
>();

/** Temporary visual furniture, in world coordinates. An unavailable site returns
 * an empty group with placed=false; never force furniture onto a path or building. */
export function createCitizenEventVenue(state: CityState, event: Event): THREE.Group {
  const group = new THREE.Group();
  group.name = `citizen-event-venue-${event.kind}`;
  group.userData.eventVenue = {
    kind: event.kind,
    endpoint: { x: event.x, z: event.z },
    placed: false,
    placements: [] as Placement[],
    feet: [] as { x: number; z: number; y: number }[],
    reason: 'no-safe-space',
  };
  const info = group.userData.eventVenue;
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  owned.set(group, { geometries, materials });
  if (!Number.isFinite(event.x) || !Number.isFinite(event.z)) return group;
  const half = state.size / 2,
    tx = Math.floor(event.x + half),
    tz = Math.floor(event.z + half);
  const obstacles = new Map<number, THREE.Box3[]>();
  const tileObstacles = (index: number): THREE.Box3[] => {
    const cached = obstacles.get(index);
    if (cached) return cached;
    const tile = state.tiles[index],
      boxes: THREE.Box3[] = [];
    if (tile.kind === 'park' || tile.kind === 'tree') {
      const model = createTileModel(tile, state);
      model.position.set(tile.x - half + 0.5, Math.max(0, tile.elevation), tile.z - half + 0.5);
      model.updateMatrixWorld(true);
      model.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        const box = new THREE.Box3().setFromObject(part);
        // Only the plain lawn slab is support. Paths, flowers and tree crowns
        // all reserve their full authored footprint, with pedestrian clearance.
        if (box.max.y <= Math.max(0, tile.elevation) + 0.0281) return;
        boxes.push(box.expandByScalar(0.045));
      });
      // Model resources are shared with the city. Do not dispose them.
    }
    obstacles.set(index, boxes);
    return boxes;
  };
  const support = (x: number, z: number) => {
    const tile = state.tiles[Math.floor(z + half) * state.size + Math.floor(x + half)];
    return Math.max(
      sampleGroundHeight(state, x, z),
      tile?.kind === 'park' ? Math.max(0, tile.elevation) + 0.028 : -Infinity,
    );
  };
  const placements: Placement[] = info.placements;
  let envelope: { x: number; z: number } | undefined;
  const place = (name: string, width: number, depth: number): Placement | undefined => {
    const candidates: { p: Placement; score: number; envelope: { x: number; z: number } }[] = [];
    for (let z = Math.max(0, tz - 1); z <= Math.min(state.size - 1, tz + 1); z++)
      for (let x = Math.max(0, tx - 1); x <= Math.min(state.size - 1, tx + 1); x++) {
        const index = z * state.size + x,
          tile = state.tiles[index];
        if (
          !['empty', 'park'].includes(tile.kind) ||
          tile.anchor >= 0 ||
          tile.elevation < 0 ||
          tile.fire
        )
          continue;
        if (
          tile.kind === 'empty' &&
          ![
            [0, 1],
            [1, 0],
            [0, -1],
            [-1, 0],
          ].some(([dx, dz]) => {
            const xx = x + dx,
              zz = z + dz;
            return (
              xx >= 0 &&
              zz >= 0 &&
              xx < state.size &&
              zz < state.size &&
              state.tiles[zz * state.size + xx].kind === 'park'
            );
          })
        )
          continue;
        const cx = x - half + 0.5,
          cz = z - half + 0.5;
        for (const dz of [-0.28, 0.28, 0])
          for (const dx of [-0.28, 0.28, 0]) {
            if (Math.abs(dx) + width / 2 > 0.46 || Math.abs(dz) + depth / 2 > 0.46) continue;
            // Keep the entire routing cross open, including approach clearance.
            if (
              tile.kind === 'park' &&
              (Math.abs(dx) - width / 2 < 0.13 || Math.abs(dz) - depth / 2 < 0.13)
            )
              continue;
            const p = { name, x: cx + dx, z: cz + dz, width, depth, tile: index };
            if (Math.hypot(p.x - event.x, p.z - event.z) > 1.75) continue;
            const env = envelope ?? { x: Math.min(tx, x), z: Math.min(tz, z) };
            if (x < env.x || x >= env.x + 2 || z < env.z || z >= env.z + 2) continue;
            const box = new THREE.Box3(
              new THREE.Vector3(p.x - width / 2, -100, p.z - depth / 2),
              new THREE.Vector3(p.x + width / 2, 100, p.z + depth / 2),
            );
            let obstructed = false;
            // Neighbouring tree crowns can overhang an otherwise empty tile.
            for (let nz = Math.max(0, z - 1); nz <= Math.min(state.size - 1, z + 1); nz++)
              for (let nx = Math.max(0, x - 1); nx <= Math.min(state.size - 1, x + 1); nx++)
                if (tileObstacles(nz * state.size + nx).some((b) => b.intersectsBox(box)))
                  obstructed = true;
            if (obstructed) continue;
            if (
              placements.some(
                (other) =>
                  Math.abs(other.x - p.x) < (other.width + width) / 2 + 0.04 &&
                  Math.abs(other.z - p.z) < (other.depth + depth) / 2 + 0.04,
              )
            )
              continue;
            const heights = [
              [-1, -1],
              [-1, 1],
              [1, -1],
              [1, 1],
            ].map(([sx, sz]) => support(p.x + (sx * width) / 2, p.z + (sz * depth) / 2));
            if (Math.max(...heights) - Math.min(...heights) > 0.07) continue;
            candidates.push({
              p,
              envelope: env,
              score: Math.hypot(p.x - event.x, p.z - event.z) + (tile.kind === 'park' ? -0.3 : 0),
            });
          }
      }
    candidates.sort((a, b) => a.score - b.score);
    const chosen = candidates[0];
    if (!chosen) return;
    envelope = chosen.envelope;
    placements.push(chosen.p);
    return chosen.p;
  };
  const main = place(
    event.kind === 'festival' ? 'stage' : 'lemonade-stand',
    event.kind === 'festival' ? 0.48 : 0.28,
    event.kind === 'festival' ? 0.36 : 0.27,
  );
  if (!main) return group;
  info.placed = true;
  info.reason = '';
  const batches = new Map<number, THREE.BufferGeometry[]>();
  const unitBox = new THREE.BoxGeometry(1, 1, 1),
    unitRound = new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    unitRoof = new THREE.ConeGeometry(0.5, 1, 4);
  const part = (
    color: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    shape: THREE.BufferGeometry = unitBox,
    ry = 0,
  ) => {
    const geometry = shape
      .clone()
      .applyMatrix4(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, y, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
          new THREE.Vector3(w, h, d),
        ),
      );
    const list = batches.get(color) ?? [];
    list.push(geometry);
    batches.set(color, list);
  };
  const wood = 0x93704a,
    cream = 0xffebc9,
    green = 0x537653,
    coral = 0xc86848,
    dark = 0x303b3e,
    gold = 0xf1c466;
  const leg = (x: number, z: number, top: number, width = 0.015) => {
    const y = support(x, z);
    info.feet.push({ x, z, y });
    part(wood, x, (top + y) / 2, z, width, top - y, width);
  };
  const canopy = (p: Placement, top: number, color: number) => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        leg(p.x + sx * (p.width / 2 - 0.018), p.z + sz * (p.depth / 2 - 0.018), top);
    part(color, p.x, top + 0.036, p.z, p.width, 0.072, p.depth, unitRoof, Math.PI / 4);
    // Thick pennants read as bunting without thin floating lines.
    for (let i = 0; i < 5; i++)
      part(
        i % 2 ? cream : gold,
        p.x + ((i - 2) * p.width) / 6,
        top - 0.012,
        p.z + p.depth / 2 - 0.012,
        p.width / 9,
        0.026,
        0.008,
        unitRoof,
        Math.PI / 4,
      );
  };
  const ground = Math.max(
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) =>
        support(main.x + sx * (main.width / 2 - 0.018), main.z + sz * (main.depth / 2 - 0.018)),
      ),
    ),
  );
  if (event.kind === 'festival') {
    const deck = ground + 0.037;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) leg(main.x + sx * 0.18, main.z + sz * 0.12, deck);
    part(wood, main.x, deck + 0.01, main.z, 0.45, 0.02, 0.32);
    canopy(main, deck + 0.24, coral);
    part(cream, main.x, deck + 0.17, main.z - 0.14, 0.26, 0.075, 0.012);
    for (const sx of [-1, 1]) {
      part(dark, main.x + sx * 0.18, deck + 0.075, main.z + 0.085, 0.055, 0.13, 0.055);
      part(gold, main.x + sx * 0.15, deck + 0.223, main.z + 0.1, 0.026, 0.018, 0.024);
    }
  } else {
    canopy(main, ground + 0.24, green);
    part(wood, main.x, ground + 0.105, main.z + 0.04, 0.24, 0.028, 0.14);
    for (const sx of [-1, 1]) leg(main.x + sx * 0.09, main.z + 0.04, ground + 0.095);
    part(cream, main.x, ground + 0.175, main.z - 0.11, 0.14, 0.052, 0.009);
    for (const dx of [-0.06, 0, 0.06])
      part(gold, main.x + dx, ground + 0.136, main.z + 0.04, 0.024, 0.03, 0.024, unitRound);
  }
  const table = place('cafe-table', 0.28, 0.28);
  if (table) {
    const y = support(table.x, table.z);
    leg(table.x, table.z, y + 0.1, 0.025);
    part(cream, table.x, y + 0.107, table.z, 0.13, 0.014, 0.13, unitRound);
    for (const sx of [-1, 1]) {
      const x = table.x + sx * 0.103,
        sy = support(x, table.z);
      leg(x, table.z, sy + 0.065, 0.018);
      part(wood, x, sy + 0.071, table.z, 0.06, 0.012, 0.06, unitRound);
    }
  }
  if (event.kind === 'festival') {
    const stall = place('food-stall', 0.28, 0.27);
    if (stall) {
      const y = support(stall.x, stall.z);
      canopy(stall, y + 0.23, green);
      part(cream, stall.x, y + 0.105, stall.z, 0.23, 0.025, 0.13);
      for (const sx of [-1, 1]) leg(stall.x + sx * 0.085, stall.z, y + 0.093);
    }
  }
  for (let i = 0; i < 2; i++) {
    const planter = place('planter', 0.095, 0.095);
    if (!planter) continue;
    const y = support(planter.x, planter.z);
    info.feet.push({ x: planter.x, z: planter.z, y });
    part(coral, planter.x, y + 0.025, planter.z, 0.085, 0.05, 0.085, unitRound);
    part(green, planter.x, y + 0.07, planter.z, 0.09, 0.045, 0.09, unitRoof);
  }
  unitBox.dispose();
  unitRound.dispose();
  unitRoof.dispose();
  for (const [color, parts] of batches) {
    const geometry = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    geometries.add(geometry);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      metalness: 0.02,
      emissive: color === gold ? gold : 0,
      emissiveIntensity: color === gold ? 0.08 : 0,
    });
    materials.add(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'citizen-venue-furniture';
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return group;
}

export function disposeCitizenEventVenue(group: THREE.Group): void {
  const resources = owned.get(group);
  if (!resources) return;
  for (const geometry of resources.geometries) geometry.dispose();
  for (const material of resources.materials) material.dispose();
  owned.delete(group);
  group.removeFromParent();
  group.clear();
}
