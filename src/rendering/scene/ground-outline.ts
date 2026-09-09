import * as THREE from 'three';
import type { CityState, Point } from '../../domain/types';
import { getFootprint } from '../../simulation/city-simulation';
import { sampleGroundHeight, TERRAIN_WATER_LEVEL } from '../world/terrain';
import { sampleRoadHeight } from '../infrastructure/roads';
import {
  getFacilityAccess,
  sampleFacilityAccessHeight,
  type FacilityAccessPlan,
} from '../../buildings/facility-access';
import { createTileModel } from '../buildings/models';
import type { Tile } from '../../domain/types';

type SupportTriangle = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type Support = {
  grid: Map<string, { points: SupportTriangle; paving: boolean }[]>;
  plan: FacilityAccessPlan | null;
  cutsX: number[];
  cutsZ: number[];
};
const localTriangles = new WeakMap<THREE.BufferGeometry, SupportTriangle[]>();
// A selection visits only a handful of anchors. Bound retained model data while
// allowing repeated live-marker samples to reuse the same authored surfaces.
const supportCaches = new WeakMap<
  CityState,
  Map<number, { signature: string; support: Support }>
>();
const cellKey = (x: number, z: number) => `${Math.floor(x * 4)}:${Math.floor(z * 4)}`;
const BIAS = 0.006;
const TOLERANCE = 0.0015;

function trianglesOf(geometry: THREE.BufferGeometry): SupportTriangle[] {
  const cached = localTriangles.get(geometry);
  if (cached) return cached;
  const p = geometry.getAttribute('position'),
    index = geometry.index;
  const result: SupportTriangle[] = [];
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const ids = [0, 1, 2].map((n) => (index ? index.getX(i + n) : i + n));
    result.push(
      ids.flatMap((id) => [p.getX(id), p.getY(id), p.getZ(id)]) as unknown as SupportTriangle,
    );
  }
  localTriangles.set(geometry, result);
  return result;
}

function supportFor(state: CityState, tile: Tile): Support {
  const plan = getFacilityAccess(state, tile);
  const signature = [
    tile.kind,
    tile.level,
    tile.variation,
    tile.rotation,
    tile.elevation,
    tile.lotWidth,
    tile.lotDepth,
    plan?.signature,
  ].join(':');
  let cache = supportCaches.get(state);
  if (!cache) {
    cache = new Map();
    supportCaches.set(state, cache);
  }
  const key = tile.z * state.size + tile.x,
    cached = cache.get(key);
  if (cached?.signature === signature) return cached.support;
  const support: Support = { grid: new Map(), plan, cutsX: [], cutsZ: [] };
  if (plan) {
    const model = createTileModel(tile, state);
    model.position.set(
      tile.x - state.size / 2 + 0.5,
      Math.max(0, tile.elevation),
      tile.z - state.size / 2 + 0.5,
    );
    model.updateMatrixWorld(true);
    model.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        object.userData.fireRoof ||
        (!object.userData.facilityFoundation && !object.userData.drivingSurface)
      )
        return;
      const authoredAccess =
        object.name.startsWith('facility-access-') ||
        object.name.startsWith('facility-foundation-');
      const bounds = new THREE.Box3().setFromObject(object);
      if (!authoredAccess && bounds.max.y > Math.max(0, tile.elevation) + 0.25) return;
      support.cutsX.push(bounds.min.x, bounds.max.x);
      support.cutsZ.push(bounds.min.z, bounds.max.z);
      for (const local of trianglesOf(object.geometry)) {
        const world: number[] = [];
        for (let i = 0; i < 9; i += 3)
          world.push(
            ...new THREE.Vector3(local[i], local[i + 1], local[i + 2])
              .applyMatrix4(object.matrixWorld)
              .toArray(),
          );
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = world;
        // Only upward low supporting faces; never side walls, undersides, or roofs.
        if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) <= 1e-10) continue;
        if (!authoredAccess && Math.max(ay, by, cy) > Math.max(0, tile.elevation) + 0.25) continue;
        const triangle = world as unknown as SupportTriangle;
        for (
          let z = Math.floor(Math.min(az, bz, cz) * 4);
          z <= Math.floor(Math.max(az, bz, cz) * 4);
          z++
        )
          for (
            let x = Math.floor(Math.min(ax, bx, cx) * 4);
            x <= Math.floor(Math.max(ax, bx, cx) * 4);
            x++
          ) {
            const bucket = `${x}:${z}`,
              list = support.grid.get(bucket) ?? [];
            list.push({
              points: triangle,
              paving:
                !!object.userData.drivingSurface && object.name !== 'facility-foundation-base',
            });
            support.grid.set(bucket, list);
          }
      }
    });
    // createTileModel uses globally cached geometry/materials. Nothing here is
    // uploaded to the GPU; drop the temporary hierarchy without disposing them.
  }
  cache.delete(key);
  cache.set(key, { signature, support });
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return support;
}

function authoredHeight(support: Support, x: number, z: number): number | null {
  let height: number | null = null;
  let paved = false;
  for (const face of support.grid.get(cellKey(x, z)) ?? []) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = face.points;
    const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / determinant;
    const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / determinant;
    if (a < -1e-7 || b < -1e-7 || a + b > 1 + 1e-7) continue;
    paved ||= face.paving;
    height = Math.max(height ?? -Infinity, a * ay + b * by + (1 - a - b) * cy);
  }
  if (paved && support.plan?.connected) {
    const access = sampleFacilityAccessHeight(support.plan, x, z);
    if (access !== null) height = Math.max(height ?? -Infinity, access);
  }
  return height;
}

export interface GroundOutlineBounds {
  x: number;
  z: number;
  width: number;
  depth: number;
}

/** Resolve the entire saved parcel, including when a child cell was clicked. */
export function selectionBounds(state: CityState, point: Point): GroundOutlineBounds | null {
  if (
    !Number.isInteger(point.x) ||
    !Number.isInteger(point.z) ||
    point.x < 0 ||
    point.z < 0 ||
    point.x >= state.size ||
    point.z >= state.size
  )
    return null;
  const clicked = state.tiles[point.z * state.size + point.x];
  const tile = clicked.anchor >= 0 ? state.tiles[clicked.anchor] : clicked;
  if (!tile) return null;
  const cells = getFootprint(state, tile);
  const points = cells.length ? cells : [tile];
  const x = Math.min(...points.map((p) => p.x)),
    z = Math.min(...points.map((p) => p.z));
  return {
    x,
    z,
    width: Math.max(...points.map((p) => p.x)) - x + 1,
    depth: Math.max(...points.map((p) => p.z)) - z + 1,
  };
}

/** The marker belongs to the pavement/foundation, never a building's roof or a
 * single average terrain height. A tiny bias prevents z-fighting. */
export function groundOutlineHeight(state: CityState, x: number, z: number): number {
  return sampleOutlineHeight(state, x, z);
}

function sampleOutlineHeight(
  state: CityState,
  x: number,
  z: number,
  roots?: Map<number, Support>,
  probeX = x,
  probeZ = z,
): number {
  const gx = Math.max(0, Math.min(state.size - 1, Math.floor(x + state.size / 2)));
  const gz = Math.max(0, Math.min(state.size - 1, Math.floor(z + state.size / 2)));
  const tile = state.tiles[gz * state.size + gx];
  if (tile.kind === 'road' || tile.kind === 'rail') return sampleRoadHeight(state, x, z) + 0.044;
  const ground = Math.max(TERRAIN_WATER_LEVEL, sampleGroundHeight(state, x, z));
  const root = tile.anchor >= 0 ? (state.tiles[tile.anchor] ?? tile) : tile;
  const key = root.z * state.size + root.x;
  let support = roots?.get(key);
  if (!support) {
    support = supportFor(state, root);
    roots?.set(key, support);
  }
  const authored = authoredHeight(support, probeX, probeZ);
  if (authored !== null) return Math.max(ground, authored) + BIAS;
  const foundation = !['empty', 'water', 'tree', 'rubble', 'powerline', 'pipe'].includes(tile.kind);
  return ground + (foundation ? 0.038 : 0.006);
}

/** A true axis-aligned rectangle, tessellated against terrain. Scaling and then
 * rotating a four-sided circular ring distorts non-square building footprints. */
export function createGroundOutline(
  state: CityState,
  bounds: GroundOutlineBounds,
): THREE.BufferGeometry {
  const inset = 0.055,
    thickness = 0.023;
  const left = bounds.x - state.size / 2 + inset,
    right = bounds.x - state.size / 2 + bounds.width - inset,
    back = bounds.z - state.size / 2 + inset,
    front = bounds.z - state.size / 2 + bounds.depth - inset;
  const vertices: number[] = [];
  const roots = new Map<number, Support>();
  for (let z = bounds.z; z < bounds.z + bounds.depth; z++)
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const tile = state.tiles[z * state.size + x];
      if (!tile) continue;
      const root = tile.anchor >= 0 ? (state.tiles[tile.anchor] ?? tile) : tile;
      const key = root.z * state.size + root.x;
      if (!roots.has(key)) roots.set(key, supportFor(state, root));
    }
  type Vertex = { x: number; y: number; z: number };
  let centerX = 0,
    centerZ = 0,
    cellMinX = 0,
    cellMaxX = 0,
    cellMinZ = 0,
    cellMaxZ = 0;
  const at = (x: number, z: number): Vertex => {
    x = Math.fround(x);
    z = Math.fround(z);
    // Duplicated vertices at a foundation step use that strip cell's own side
    // of the boundary, keeping both flat levels flush without a hovering ramp.
    return {
      x,
      z,
      y: sampleOutlineHeight(
        state,
        x,
        z,
        roots,
        x === cellMinX || x === cellMaxX ? x + (centerX - x) * 0.001 : x,
        z === cellMinZ || z === cellMaxZ ? z + (centerZ - z) * 0.001 : z,
      ),
    };
  };
  const midpoint = (a: Vertex, b: Vertex) => at((a.x + b.x) / 2, (a.z + b.z) / 2);
  const triangle = (a: Vertex, b: Vertex, c: Vertex, depth = 0): void => {
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      ca = midpoint(c, a);
    const center = at((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
    const errors = [
      ab.y - (a.y + b.y) / 2,
      bc.y - (b.y + c.y) / 2,
      ca.y - (c.y + a.y) / 2,
      center.y - (a.y + b.y + c.y) / 3,
    ];
    // A sharp shoulder can miss both edge midpoints and the centroid.
    for (const [wa, wb, wc] of [
      [0.8, 0.1, 0.1],
      [0.1, 0.8, 0.1],
      [0.1, 0.1, 0.8],
      [0.45, 0.45, 0.1],
      [0.1, 0.45, 0.45],
    ]) {
      errors.push(
        at(a.x * wa + b.x * wb + c.x * wc, a.z * wa + b.z * wb + c.z * wc).y -
          (a.y * wa + b.y * wb + c.y * wc),
      );
    }
    if (Math.max(...errors.map(Math.abs)) > TOLERANCE && depth < 6) {
      triangle(a, ab, ca, depth + 1);
      triangle(ab, b, bc, depth + 1);
      triangle(ca, bc, c, depth + 1);
      triangle(ab, bc, ca, depth + 1);
    } else {
      // At an authored step a continuous strip cannot represent a vertical
      // discontinuity. Conservatively lift only this smallest local triangle.
      const lift = Math.max(0, ...errors);
      for (const p of [a, b, c]) vertices.push(p.x, p.y + (lift > TOLERANCE ? lift : 0), p.z);
    }
  };
  for (const [ax, az, bx, bz, ox, oz] of [
    [left, back, right, back, 0, thickness],
    [right, back, right, front, -thickness, 0],
    [right, front, left, front, 0, -thickness],
    [left, front, left, back, thickness, 0],
  ]) {
    const minX = Math.min(ax, bx, ax + ox, bx + ox),
      maxX = Math.max(ax, bx, ax + ox, bx + ox);
    const minZ = Math.min(az, bz, az + oz, bz + oz),
      maxZ = Math.max(az, bz, az + oz, bz + oz);
    const cuts = (min: number, max: number, extra: number[]) => {
      const steps = Math.max(1, Math.ceil((max - min) / 0.1));
      return [
        ...new Set(
          [
            min,
            max,
            ...Array.from({ length: steps - 1 }, (_, i) => min + ((max - min) * (i + 1)) / steps),
            ...extra.filter((v) => v > min + 1e-5 && v < max - 1e-5),
          ].map(Math.fround),
        ),
      ].sort((a, b) => a - b);
    };
    const xs = cuts(
      minX,
      maxX,
      [...roots.values()].flatMap((s) => s.cutsX),
    );
    const zs = cuts(
      minZ,
      maxZ,
      [...roots.values()].flatMap((s) => s.cutsZ),
    );
    for (let zi = 0; zi < zs.length - 1; zi++)
      for (let xi = 0; xi < xs.length - 1; xi++) {
        centerX = (xs[xi] + xs[xi + 1]) / 2;
        centerZ = (zs[zi] + zs[zi + 1]) / 2;
        cellMinX = xs[xi];
        cellMaxX = xs[xi + 1];
        cellMinZ = zs[zi];
        cellMaxZ = zs[zi + 1];
        const a = at(xs[xi], zs[zi]),
          b = at(xs[xi], zs[zi + 1]),
          c = at(xs[xi + 1], zs[zi + 1]),
          d = at(xs[xi + 1], zs[zi]);
        triangle(a, b, c);
        triangle(a, c, d);
      }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
