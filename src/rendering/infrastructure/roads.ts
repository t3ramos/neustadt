import * as THREE from 'three';
import type { CityState, Tile } from '../../domain/types';
import { lanePose } from '../../traffic/lanes';

const directions = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

/** Only two adjacent arms form a bend. Three/four arms remain intersections. */
export function roadBend(mask: number): [number, number] | null {
  const arms = directions.flatMap((_, i) => (mask & (1 << i) ? [i] : []));
  return arms.length === 2 && (arms[0] + 2) % 4 !== arms[1] ? [arms[0], arms[1]] : null;
}

export function roadBendPoint(
  mask: number,
  progress: number,
  offset = 0,
): { x: number; z: number } {
  const bend = roadBend(mask);
  if (!bend) throw new Error('A road bend requires two perpendicular connections');
  const pose = lanePose(directions[bend[0]], { x: 0, z: 0 }, directions[bend[1]], progress, offset);
  return { x: pose.x - 0.5, z: pose.z - 0.5 };
}

/** A closed road ribbon, using the same family of curves as the traffic lanes. */
export function roadBendGeometry(
  mask: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const steps = 32;
  const row = (i: number, offset: number, y: number): THREE.Vector3 => {
    const p = roadBendPoint(mask, i / steps, offset);
    return new THREE.Vector3(p.x, y, p.z);
  };
  function face(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    up = false,
  ): void {
    if (
      up &&
      new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y < 0
    )
      [b, d] = [d, b];
    for (const p of [a, b, c, a, c, d]) positions.push(p.x, p.y, p.z);
  }
  for (let i = 0; i < steps; i++) {
    face(
      row(i, left, top),
      row(i + 1, left, top),
      row(i + 1, right, top),
      row(i, right, top),
      true,
    );
    // Both sides are visible from above on hills; use explicit outward winding.
    const a = row(i, left, top),
      b = row(i + 1, left, top),
      c = row(i + 1, right, top);
    const positive =
      new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y > 0;
    for (const [offset, reverse] of [
      [left, positive],
      [right, !positive],
    ] as const) {
      const vertices = [
        row(i, offset, bottom),
        row(i + 1, offset, bottom),
        row(i + 1, offset, top),
        row(i, offset, top),
      ];
      if (reverse) vertices.reverse();
      face(vertices[0], vertices[1], vertices[2], vertices[3]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const isTransport = (tile: Tile) => tile.kind === 'road' || tile.kind === 'rail';

/** Smooth isolated terrain spikes along the connected road, never across nearby hills.
 * A two-tile approach distributes the grade change instead of making an accordion.
 * Submerged tiles stay at sea level so a bridge cannot inherit seabed depth.
 */
export function roadTileHeight(state: CityState, tile: Tile): number {
  if (tile.elevation <= 0) return 0;
  let sum = tile.elevation * 3,
    weight = 3;
  const visited = new Set<number>([tile.z * state.size + tile.x]);
  let frontier = [tile];
  for (let distance = 1; distance <= 2; distance++) {
    const next: Tile[] = [];
    for (const current of frontier)
      for (const direction of directions) {
        const x = current.x + direction.x,
          z = current.z + direction.z;
        if (x < 0 || z < 0 || x >= state.size || z >= state.size) continue;
        const key = z * state.size + x,
          neighbor = state.tiles[key];
        if (visited.has(key) || !isTransport(neighbor)) continue;
        visited.add(key);
        next.push(neighbor);
        const w = 3 - distance;
        sum += Math.max(0, neighbor.elevation) * w;
        weight += w;
      }
    frontier = next;
  }
  return sum / weight;
}

/** Shared transport corners ignore nearby hills; bridge decks use sea level, not seabed height. */
export function roadCornerHeight(state: CityState, x: number, z: number): number | null {
  let sum = 0,
    count = 0;
  for (let dz = -1; dz <= 0; dz++)
    for (let dx = -1; dx <= 0; dx++) {
      const xx = x + dx,
        zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= state.size || zz >= state.size) continue;
      const tile = state.tiles[zz * state.size + xx];
      if (!isTransport(tile)) continue;
      sum += roadTileHeight(state, tile);
      count++;
    }
  return count ? sum / count : null;
}

/**
 * Exact road/rail deck base in centered world coordinates. Add the existing pavement thickness
 * separately (approximately .052 for vehicle contact). No height is derived from water depth.
 * The same NW–SE triangle split is used by warped meshes and the land beneath roads.
 */
export function sampleRoadHeight(state: CityState, worldX: number, worldZ: number): number {
  const gx = THREE.MathUtils.clamp(worldX + state.size / 2, 0, state.size - 1e-8);
  const gz = THREE.MathUtils.clamp(worldZ + state.size / 2, 0, state.size - 1e-8);
  const x = Math.floor(gx),
    z = Math.floor(gz),
    u = gx - x,
    v = gz - z;
  const base = Math.max(0, state.tiles[z * state.size + x].elevation);
  const nw = roadCornerHeight(state, x, z) ?? base,
    ne = roadCornerHeight(state, x + 1, z) ?? base;
  const se = roadCornerHeight(state, x + 1, z + 1) ?? base,
    sw = roadCornerHeight(state, x, z + 1) ?? base;
  return v <= u ? nw + (ne - nw) * u + (se - ne) * v : nw + (se - sw) * u + (sw - nw) * v;
}

// The model system deliberately shares primitives. Keep their untouched source across re-warps.
const sourceGeometries = new WeakMap<THREE.Mesh, THREE.BufferGeometry>();

/**
 * Warp a freshly created transport model BEFORE positioning its root over the map tile.
 * Mesh-local rotations/scales and a rail root's 90-degree rotation are retained. Shared source
 * primitives are never changed. Splitting triangles at the terrain diagonal makes the asphalt,
 * curbs and markings follow exactly the same surface instead of floating over a coarse quad.
 */
export function warpRoadModel(model: THREE.Group, tile: Tile, state: CityState): void {
  if (!isTransport(tile)) return;
  model.updateWorldMatrix(true, true);
  const parentInverse = model.parent
    ? model.parent.matrixWorld.clone().invert()
    : new THREE.Matrix4();
  const centerX = tile.x - state.size / 2 + 0.5,
    centerZ = tile.z - state.size / 2 + 0.5;
  const base = Math.max(0, tile.elevation);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source: THREE.BufferGeometry = sourceGeometries.get(object) ?? object.geometry;
    if (!sourceGeometries.has(object)) sourceGeometries.set(object, source);
    const geometry = source.clone();
    const transform = parentInverse.clone().multiply(object.matrixWorld),
      inverse = transform.clone().invert();
    const attributes = Object.entries(geometry.attributes);
    const values = new Map<string, number[]>();
    for (const [name, attribute] of attributes) {
      const data: number[] = [];
      for (let i = 0; i < attribute.count; i++)
        for (let component = 0; component < attribute.itemSize; component++)
          data.push(attribute.getComponent(i, component));
      values.set(name, data);
    }
    const points = values.get('position')!;
    const distances: number[] = [];
    const vector = new THREE.Vector3();
    for (let i = 0; i < points.length; i += 3) {
      vector.set(points[i], points[i + 1], points[i + 2]).applyMatrix4(transform);
      distances.push(vector.x - vector.z);
    }
    const crossings = new Map<string, number>();
    function crossing(a: number, b: number): number {
      if (Math.abs(distances[a]) < 1e-9) return a;
      if (Math.abs(distances[b]) < 1e-9) return b;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const existing = crossings.get(key);
      if (existing !== undefined) return existing;
      const t = distances[a] / (distances[a] - distances[b]);
      const index = points.length / 3;
      for (const [name, attribute] of attributes) {
        const data = values.get(name)!;
        for (let component = 0; component < attribute.itemSize; component++) {
          data.push(
            THREE.MathUtils.lerp(
              data[a * attribute.itemSize + component],
              data[b * attribute.itemSize + component],
              t,
            ),
          );
        }
      }
      distances.push(0);
      crossings.set(key, index);
      return index;
    }
    function clip(triangle: number[], positive: boolean): number[] {
      const result: number[] = [];
      for (let i = 0; i < triangle.length; i++) {
        const a = triangle[i],
          b = triangle[(i + 1) % triangle.length];
        const insideA = positive ? distances[a] >= -1e-9 : distances[a] <= 1e-9;
        const insideB = positive ? distances[b] >= -1e-9 : distances[b] <= 1e-9;
        if (insideA) result.push(a);
        if (insideA !== insideB) result.push(crossing(a, b));
      }
      return result
        .filter((index, i) => i === 0 || index !== result[i - 1])
        .filter((index, i, array) => i !== array.length - 1 || index !== array[0]);
    }
    const originalIndices = geometry.index
      ? Array.from(geometry.index.array)
      : Array.from({ length: points.length / 3 }, (_, i) => i);
    const originalGroups = geometry.groups.length
      ? geometry.groups.map((group) => ({ ...group }))
      : [{ start: 0, count: originalIndices.length, materialIndex: 0 }];
    const indices: number[] = [];
    geometry.clearGroups();
    for (const group of originalGroups) {
      const start = indices.length;
      for (
        let offset = group.start;
        offset < Math.min(originalIndices.length, group.start + group.count);
        offset += 3
      ) {
        const triangle = originalIndices.slice(offset, offset + 3);
        if (triangle.length < 3) continue;
        const ds = triangle.map((index) => distances[index]);
        if (!ds.some((d) => d > 1e-9) || !ds.some((d) => d < -1e-9)) {
          indices.push(...triangle);
          continue;
        }
        for (const positive of [true, false]) {
          const polygon = clip(triangle, positive);
          for (let i = 1; i < polygon.length - 1; i++)
            indices.push(polygon[0], polygon[i], polygon[i + 1]);
        }
      }
      if (indices.length > start)
        geometry.addGroup(start, indices.length - start, group.materialIndex);
    }
    for (let i = 0; i < points.length; i += 3) {
      vector.set(points[i], points[i + 1], points[i + 2]).applyMatrix4(transform);
      vector.y += sampleRoadHeight(state, centerX + vector.x, centerZ + vector.z) - base;
      vector.applyMatrix4(inverse);
      points[i] = vector.x;
      points[i + 1] = vector.y;
      points[i + 2] = vector.z;
    }
    for (const [name, attribute] of attributes)
      geometry.setAttribute(
        name,
        new THREE.Float32BufferAttribute(
          values.get(name)!,
          attribute.itemSize,
          attribute.normalized,
        ),
      );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (object.geometry !== source) object.geometry.dispose();
    object.geometry = geometry;
  });
}
