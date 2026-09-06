import * as THREE from 'three';
import type { CityState, Tile } from '../../domain/types';
import { roadCornerHeight, roadTileHeight } from '../infrastructure/roads';
import {
  getFacilityAccess,
  sampleFacilityAccessHeight,
  facilityAccessSignature,
  FACILITY_PAVEMENT_HEIGHT,
} from '../../buildings/facility-access';

export interface TerrainMaterials {
  ground: THREE.MeshStandardMaterial;
  earth: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
}

// A building keeps a level foundation; a thin border joins it to the continuous landscape.
const FOUNDATION_INSET = 0.04;
const TEXTURE_WORLD_SIZE = 6;
const flatKinds = new Set([
  'residential',
  'commercial',
  'industrial',
  'power',
  'waterpump',
  'park',
  'beach',
  'police',
  'fire',
  'hospital',
  'school',
  'stadium',
  'airport',
  'seaport',
  'wind',
  'solar',
  'university',
  'recycling',
]);
const isTransport = (tile: Tile) => tile.kind === 'road' || tile.kind === 'rail';
const isFoundation = (tile: Tile) => flatKinds.has(tile.kind) && tile.elevation >= 0;
const smoothstep = (a: number, b: number, n: number) => {
  const t = THREE.MathUtils.clamp((n - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash = (x: number, z: number, seed = 1) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 17.77) * 43758.5453;
  return n - Math.floor(n);
};

function periodicNoise(x: number, y: number, period: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const tx = fx * fx * (3 - 2 * fx),
    ty = fy * fy * (3 - 2 * fy);
  const at = (dx: number, dy: number) => hash((ix + dx) % period, (iy + dy) % period, 23);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(at(0, 0), at(1, 0), tx),
    THREE.MathUtils.lerp(at(0, 1), at(1, 1), tx),
    ty,
  );
}

/** Original, seamlessly repeating turf albedo, micro-normal and roughness maps. */
export function createTerrainMaterials(): TerrainMaterials {
  const resolution = 512;
  const albedo = document.createElement('canvas');
  const normal = document.createElement('canvas');
  const roughness = document.createElement('canvas');
  for (const canvas of [albedo, normal, roughness]) canvas.width = canvas.height = resolution;
  const colorContext = albedo.getContext('2d')!;
  const normalContext = normal.getContext('2d')!;
  const roughContext = roughness.getContext('2d')!;
  const colorData = colorContext.createImageData(resolution, resolution);
  const normalData = normalContext.createImageData(resolution, resolution);
  const roughData = roughContext.createImageData(resolution, resolution);
  const height = new Float32Array(resolution * resolution);
  for (let y = 0; y < resolution; y++)
    for (let x = 0; x < resolution; x++) {
      const u = x / resolution,
        v = y / resolution;
      const broad = periodicNoise(u * 4, v * 4, 4);
      const tuft = periodicNoise(u * 32, v * 32, 32);
      const fine = periodicNoise(u * 128, v * 128, 128);
      const grain = hash(x, y, 51);
      const dry = smoothstep(0.55, 0.85, broad) * 0.055;
      const luminance =
        0.93 +
        (broad - 0.5) * 0.075 +
        (tuft - 0.5) * 0.065 +
        (fine - 0.5) * 0.035 +
        (grain - 0.5) * 0.018;
      const offset = (y * resolution + x) * 4;
      // Near-neutral albedo lets vertex colors blend grass into sand and mountain rock.
      colorData.data[offset] = Math.min(255, 255 * (luminance + dry));
      colorData.data[offset + 1] = Math.min(255, 255 * luminance);
      colorData.data[offset + 2] = Math.min(255, 255 * (luminance - dry * 0.65));
      colorData.data[offset + 3] = 255;
      const r = Math.round(232 + tuft * 20);
      roughData.data[offset] = roughData.data[offset + 1] = roughData.data[offset + 2] = r;
      roughData.data[offset + 3] = 255;
      height[y * resolution + x] = tuft * 0.6 + fine * 0.3 + grain * 0.06;
    }
  for (let y = 0; y < resolution; y++)
    for (let x = 0; x < resolution; x++) {
      const get = (dx: number, dy: number) =>
        height[
          ((y + dy + resolution) % resolution) * resolution + ((x + dx + resolution) % resolution)
        ];
      const nx = (get(-1, 0) - get(1, 0)) * 0.65,
        ny = (get(0, -1) - get(0, 1)) * 0.65;
      const length = Math.sqrt(nx * nx + ny * ny + 1),
        offset = (y * resolution + x) * 4;
      normalData.data[offset] = ((nx / length) * 0.5 + 0.5) * 255;
      normalData.data[offset + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      normalData.data[offset + 2] = ((1 / length) * 0.5 + 0.5) * 255;
      normalData.data[offset + 3] = 255;
    }
  colorContext.putImageData(colorData, 0, 0);
  normalContext.putImageData(normalData, 0, 0);
  roughContext.putImageData(roughData, 0, 0);
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normal);
  const roughnessMap = new THREE.CanvasTexture(roughness);
  for (const texture of [map, normalMap, roughnessMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
  }
  return {
    ground: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap,
      roughness: 1,
      metalness: 0,
    }),
    earth: new THREE.MeshStandardMaterial({ color: 0x8e8770, roughness: 1, metalness: 0 }),
    rock: new THREE.MeshStandardMaterial({ color: 0xa9ad9d, roughness: 0.95, metalness: 0 }),
  };
}

function cornerHeight(state: CityState, x: number, z: number): number {
  let sum = 0,
    count = 0;
  let hasLandTransport = false;
  for (let dz = -1; dz <= 0; dz++)
    for (let dx = -1; dx <= 0; dx++) {
      const xx = x + dx,
        zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= state.size || zz >= state.size) continue;
      const tile = state.tiles[zz * state.size + xx];
      sum += tile.elevation;
      hasLandTransport ||= isTransport(tile) && tile.elevation >= 0;
      count++;
    }
  // Match the drivable deck on land. Bridge-only corners retain the submerged seabed.
  if (hasLandTransport) return roadCornerHeight(state, x, z) ?? (count ? sum / count : 0);
  return count ? sum / count : 0;
}

function cornerNormal(state: CityState, x: number, z: number): [number, number, number] {
  const xa = Math.max(0, x - 1),
    xb = Math.min(state.size, x + 1);
  const za = Math.max(0, z - 1),
    zb = Math.min(state.size, z + 1);
  const dx = (cornerHeight(state, xb, z) - cornerHeight(state, xa, z)) / Math.max(1, xb - xa);
  const dz = (cornerHeight(state, x, zb) - cornerHeight(state, x, za)) / Math.max(1, zb - za);
  const length = Math.sqrt(dx * dx + dz * dz + 1);
  return [-dx / length, 1 / length, -dz / length];
}

function terrainColor(
  x: number,
  z: number,
  elevation: number,
  slope: number,
  seed: number,
): THREE.Color {
  // Long, overlapping waves avoid the old random green checkerboard at tile boundaries.
  const variation =
    Math.sin(x * 0.113 + seed * 0.001) * Math.cos(z * 0.087) * 0.025 +
    Math.sin((x + z) * 0.247) * 0.012;
  const grass = new THREE.Color().setHSL(0.221 + variation * 0.12, 0.3, 0.44 + variation);
  const shore = 1 - smoothstep(-0.55, -0.015, elevation);
  grass.lerp(new THREE.Color(0xc8c0a2), shore * 0.93);
  const rock = Math.max(
    smoothstep(0.55, 1.7, slope) * smoothstep(0.7, 2, elevation),
    smoothstep(5.5, 10.5, elevation) * 0.85,
  );
  grass.lerp(new THREE.Color(0xaaa99c), rock * 0.8);
  return grass;
}

/** cx/cz are tile origins, rather than chunk indices. All positions are in centered world space. */
export function buildTerrainChunk(
  state: CityState,
  cx: number,
  cz: number,
  chunk: number,
  materials: TerrainMaterials,
): THREE.Group {
  const endX = Math.min(state.size, cx + chunk),
    endZ = Math.min(state.size, cz + chunk);
  const half = state.size / 2;
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const corners = new Map<number, number>();
  function vertex(x: number, z: number, y: number, n: [number, number, number]): number {
    const index = positions.length / 3;
    positions.push(x - half, y, z - half);
    normals.push(...n);
    uvs.push(x / TEXTURE_WORLD_SIZE, -z / TEXTURE_WORLD_SIZE);
    const color = terrainColor(
      x,
      z,
      y,
      Math.sqrt(n[0] * n[0] + n[2] * n[2]) / Math.max(0.01, n[1]),
      state.seed,
    );
    colors.push(color.r, color.g, color.b);
    return index;
  }
  function corner(x: number, z: number): number {
    const key = z * (state.size + 1) + x;
    let index = corners.get(key);
    if (index === undefined) {
      index = vertex(x, z, cornerHeight(state, x, z), cornerNormal(state, x, z));
      corners.set(key, index);
    }
    return index;
  }
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, c, b, a, d, c);
  for (let z = cz; z < endZ; z++)
    for (let x = cx; x < endX; x++) {
      const tile = state.tiles[z * state.size + x];
      const outer = [corner(x, z), corner(x + 1, z), corner(x + 1, z + 1), corner(x, z + 1)];
      if (!isFoundation(tile)) {
        quad(...(outer as [number, number, number, number]));
        continue;
      }
      const inset = FOUNDATION_INSET;
      const accessPlan = getFacilityAccess(state, tile);
      if (accessPlan?.connected) {
        const divisions = 16,
          grid: number[][] = [];
        for (let iz = 0; iz <= divisions; iz++) {
          const row: number[] = [];
          for (let ix = 0; ix <= divisions; ix++) {
            const px = x + ix / divisions,
              pz = z + iz / divisions,
              wx = px - half,
              wz = pz - half;
            const y = sampleGroundHeight(state, wx, wz);
            row.push(vertex(px, pz, y, [0, 1, 0]));
          }
          grid.push(row);
        }
        for (let iz = 0; iz < divisions; iz++)
          for (let ix = 0; ix < divisions; ix++)
            quad(grid[iz][ix], grid[iz][ix + 1], grid[iz + 1][ix + 1], grid[iz + 1][ix]);
        continue;
      }
      const inner = [
        vertex(x + inset, z + inset, tile.elevation, [0, 1, 0]),
        vertex(x + 1 - inset, z + inset, tile.elevation, [0, 1, 0]),
        vertex(x + 1 - inset, z + 1 - inset, tile.elevation, [0, 1, 0]),
        vertex(x + inset, z + 1 - inset, tile.elevation, [0, 1, 0]),
      ];
      quad(...(inner as [number, number, number, number]));
      for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        quad(outer[side], outer[next], inner[next], inner[side]);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, materials.ground);
  mesh.name = 'continuous-terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const result = new THREE.Group();
  result.name = `terrain-${cx}-${cz}`;
  result.add(mesh);
  return result;
}

/** The normal halo includes the derived road grade, whose connected approach extends two more tiles. */
export function terrainChunkSignature(
  state: CityState,
  cx: number,
  cz: number,
  chunk: number,
): string {
  let signature = 2166136261;
  const accessSeen = new Set<string>();
  for (let z = Math.max(0, cz - 2); z < Math.min(state.size, cz + chunk + 2); z++)
    for (let x = Math.max(0, cx - 2); x < Math.min(state.size, cx + chunk + 2); x++) {
      const tile = state.tiles[z * state.size + x];
      signature = Math.imul(signature ^ Math.round((tile.elevation + 32) * 1024), 16777619);
      if (isTransport(tile))
        signature = Math.imul(signature ^ Math.round(roadTileHeight(state, tile) * 1e6), 16777619);
      signature = Math.imul(
        signature ^ (Number(isFoundation(tile)) + (isTransport(tile) ? 2 : 0)),
        16777619,
      );
      const access = facilityAccessSignature(state, tile);
      if (access && !accessSeen.has(access)) {
        accessSeen.add(access);
        for (const c of access) signature = Math.imul(signature ^ c.charCodeAt(0), 16777619);
      }
    }
  return `${state.size}:${state.seed}:${signature >>> 0}`;
}

function triangleHeight(
  x: number,
  z: number,
  a: number[],
  b: number[],
  c: number[],
): number | null {
  const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(d) < 1e-12) return null;
  const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
  const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
  const wc = 1 - wa - wb;
  return wa >= -1e-8 && wb >= -1e-8 && wc >= -1e-8 ? wa * a[1] + wb * b[1] + wc * c[1] : null;
}

/** Exact surface height of the triangles above, useful for terrain-aware cursors and vehicles. */
function sampleRawGroundHeight(state: CityState, worldX: number, worldZ: number): number {
  const gx = THREE.MathUtils.clamp(worldX + state.size / 2, 0, state.size - 1e-8);
  const gz = THREE.MathUtils.clamp(worldZ + state.size / 2, 0, state.size - 1e-8);
  const x = Math.floor(gx),
    z = Math.floor(gz),
    u = gx - x,
    v = gz - z;
  const tile = state.tiles[z * state.size + x];
  const outer = [
    [0, cornerHeight(state, x, z), 0],
    [1, cornerHeight(state, x + 1, z), 0],
    [1, cornerHeight(state, x + 1, z + 1), 1],
    [0, cornerHeight(state, x, z + 1), 1],
  ];
  const quadHeight = (p: number[][]) =>
    triangleHeight(u, v, p[0], p[2], p[1]) ?? triangleHeight(u, v, p[0], p[3], p[2]);
  if (!isFoundation(tile)) return quadHeight(outer) ?? tile.elevation;
  const inset = FOUNDATION_INSET;
  if (u >= inset && u <= 1 - inset && v >= inset && v <= 1 - inset) return tile.elevation;
  const inner = [
    [inset, tile.elevation, inset],
    [1 - inset, tile.elevation, inset],
    [1 - inset, tile.elevation, 1 - inset],
    [inset, tile.elevation, 1 - inset],
  ];
  for (let side = 0; side < 4; side++) {
    const next = (side + 1) % 4;
    const y = quadHeight([outer[side], outer[next], inner[next], inner[side]]);
    if (y !== null) return y;
  }
  return tile.elevation;
}

/** The drive cuts its ramp through the original foundation border. This exact
 * height is sampled by terrain tessellation as well as the vehicle slope test. */
export function sampleGroundHeight(state: CityState, worldX: number, worldZ: number): number {
  const raw = sampleRawGroundHeight(state, worldX, worldZ);
  const x = Math.floor(worldX + state.size / 2),
    z = Math.floor(worldZ + state.size / 2);
  const tile =
    x >= 0 && z >= 0 && x < state.size && z < state.size
      ? state.tiles[z * state.size + x]
      : undefined;
  const plan = tile ? getFacilityAccess(state, tile) : null;
  if (!plan?.connected) return raw;
  const access = sampleFacilityAccessHeight(plan, worldX, worldZ);
  return access === null ? raw : Math.min(raw, access - FACILITY_PAVEMENT_HEIGHT);
}

/** The visible ocean surface and its cutaway side share this exact height. */
export const TERRAIN_WATER_LEVEL = -0.08;

/** All side faces and the underside terminate at one stable, solid plate floor. */
export function getTerrainPlateFloor(state: CityState): number {
  let floor = -3;
  for (const tile of state.tiles) floor = Math.min(floor, tile.elevation - 2);
  return floor;
}

/** A finite geological cutaway. The top follows the actual terrain and road boundary;
 * submerged edge sections are closed up to the ocean surface by opaque water faces.
 * There is no additional land surface outside the playable square. */
export function buildTerrainSkirt(
  state: CityState,
  material: THREE.MeshStandardMaterial,
): THREE.Group {
  const half = state.size / 2,
    floor = getTerrainPlateFloor(state);
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const waterPositions: number[] = [],
    waterIndices: number[] = [];
  const layers = [0, 0.045, 0.15, 0.32, 0.55, 0.78, 1];
  const strata = [0x7e795b, 0x9d8665, 0xb4a085, 0x999183, 0xb6ab97, 0x918b7d];
  function quad(
    target: number[],
    faces: number[],
    a: number[],
    b: number[],
    c: number[],
    d: number[],
  ) {
    const i = target.length / 3;
    target.push(...a, ...b, ...c, ...d);
    // At a shoreline crossing one water corner collapses; omit that zero-area triangle.
    if (b.some((value, axis) => value !== c[axis])) faces.push(i, i + 2, i + 1);
    if (a.some((value, axis) => value !== d[axis])) faces.push(i, i + 3, i + 2);
  }
  function segment(ax: number, az: number, bx: number, bz: number) {
    const ay = cornerHeight(state, ax, az),
      by = cornerHeight(state, bx, bz);
    const a = [ax - half, ay, az - half],
      b = [bx - half, by, bz - half];
    for (let band = 0; band < layers.length - 1; band++) {
      const upper = layers[band],
        lower = layers[band + 1];
      quad(
        positions,
        indices,
        [a[0], THREE.MathUtils.lerp(ay, floor, upper), a[2]],
        [b[0], THREE.MathUtils.lerp(by, floor, upper), b[2]],
        [b[0], THREE.MathUtils.lerp(by, floor, lower), b[2]],
        [a[0], THREE.MathUtils.lerp(ay, floor, lower), a[2]],
      );
      // Shared endpoint variation keeps adjacent segments continuous, with restrained mineral grain.
      for (const point of [a, b, b, a]) {
        const tone = 1 + Math.sin(point[0] * 0.43 + point[2] * 0.31 + state.seed * 0.01) * 0.025;
        const color = new THREE.Color(strata[band]).multiplyScalar(tone);
        colors.push(color.r, color.g, color.b);
      }
    }
    if (ay >= TERRAIN_WATER_LEVEL && by >= TERRAIN_WATER_LEVEL) return;
    // Clip the shoreline crossing rather than drawing a water wall over dry terrain.
    const clippedA = [...a],
      clippedB = [...b];
    if (ay < TERRAIN_WATER_LEVEL !== by < TERRAIN_WATER_LEVEL) {
      const t = (TERRAIN_WATER_LEVEL - ay) / (by - ay);
      const crossing = [
        THREE.MathUtils.lerp(a[0], b[0], t),
        TERRAIN_WATER_LEVEL,
        THREE.MathUtils.lerp(a[2], b[2], t),
      ];
      if (ay >= TERRAIN_WATER_LEVEL) clippedA.splice(0, 3, ...crossing);
      else clippedB.splice(0, 3, ...crossing);
    }
    quad(
      waterPositions,
      waterIndices,
      [clippedA[0], TERRAIN_WATER_LEVEL, clippedA[2]],
      [clippedB[0], TERRAIN_WATER_LEVEL, clippedB[2]],
      clippedB,
      clippedA,
    );
  }
  for (let i = 0; i < state.size; i++) {
    segment(i + 1, 0, i, 0);
    segment(i, state.size, i + 1, state.size);
    segment(0, i, 0, i + 1);
    segment(state.size, i + 1, state.size, i);
  }
  const earth = material.clone();
  earth.color.set(0xffffff);
  earth.vertexColors = true;
  earth.emissive.set(0x403a30);
  earth.emissiveIntensity = 0.16;
  earth.roughness = 1;
  earth.transparent = false;
  earth.opacity = 1;
  const group = new THREE.Group();
  group.name = 'terrain-skirt';
  group.userData.plateFloor = floor;
  group.userData.ownedMaterials = [earth];
  function mesh(
    name: string,
    points: number[],
    faces: number[],
    surface: THREE.Material,
    vertexColors?: number[],
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    if (vertexColors)
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
    geometry.setIndex(faces);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const item = new THREE.Mesh(geometry, surface);
    item.name = name;
    item.castShadow = true;
    item.receiveShadow = false;
    group.add(item);
  }
  mesh('terrain-perimeter', positions, indices, earth, colors);
  // Downward-facing bottom seals the plate without a second top plane or overlapping faces.
  const underside = new THREE.MeshStandardMaterial({ color: 0x8c8473, roughness: 1 });
  group.userData.ownedMaterials.push(underside);
  mesh(
    'terrain-underside',
    [-half, floor, -half, half, floor, -half, half, floor, half, -half, floor, half],
    [0, 1, 2, 0, 2, 3],
    underside,
  );
  if (waterPositions.length) {
    const water = new THREE.MeshStandardMaterial({
      color: 0x427d85,
      emissive: 0x16353c,
      emissiveIntensity: 0.2,
      roughness: 0.7,
    });
    group.userData.ownedMaterials.push(water);
    mesh('terrain-water-edge', waterPositions, waterIndices, water);
  }
  return group;
}
