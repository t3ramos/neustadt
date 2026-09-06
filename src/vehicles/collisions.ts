import * as THREE from 'three';
import { createTileModel } from '../rendering/buildings/models';
import { sampleGroundHeight } from '../rendering/world/terrain';
import { getRoadStreetlightFixture } from '../rendering/lighting/streetlights';
import type { CityState, Tile } from '../domain/types';
import { facilityAccessSignature } from '../buildings/facility-access';
import { getPowerLayout, powerLayoutSignature } from '../infrastructure/power-layout';
import { powerServiceModelPlacement } from '../rendering/infrastructure/power';

export interface DrivingCollisionDimensions {
  halfWidth: number;
  halfLength: number;
  height: number;
}
export interface DrivingCollisionWorld {
  setState(state: CityState): void;
  collides(
    x: number,
    z: number,
    yaw: number,
    dimensions?: DrivingCollisionDimensions,
    groundY?: number,
  ): string | undefined;
  pointBlocked(x: number, z: number, groundY?: number): boolean;
  /** World-space visible geometry, including roofs; callers must not mutate it. */
  getShapesNear(x: number, z: number, radius: number): readonly DrivingCollisionShape[];
  /** Cheap graph validation against one tile/anchor, excluding neighboring lots and utilities. */
  tileCollides(
    tileIndex: number,
    x: number,
    z: number,
    yaw: number,
    dimensions?: DrivingCollisionDimensions,
    groundY?: number,
  ): string | undefined;
  /** Supports wheels on thin foundations, parking aprons and the stadium pitch. */
  surfaceHeight(x: number, z: number, baseGroundY: number): number;
  dispose(): void;
}

type Point2 = { x: number; z: number };
type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};
export interface DrivingCollisionShape extends Bounds {
  triangles: Float64Array;
  polygon?: Point2[];
  surface: boolean;
}
const DEFAULT_BODY: DrivingCollisionDimensions = {
  halfWidth: 0.095,
  halfLength: 0.18,
  height: 0.18,
};
const EPSILON = 1e-7;
const localComponents = new WeakMap<THREE.BufferGeometry, Float64Array[]>();
const noModel = new Set<Tile['kind']>(['empty', 'water', 'rail']);
const lampPoleGeometry = new THREE.CylinderGeometry(0.76, 1, 1, 10);
const lampBaseGeometry = new THREE.CylinderGeometry(0.48 / 0.62, 1, 1, 10);
const lampBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const collisionMaterial = new THREE.MeshBasicMaterial();
const powerMastGeometry = new THREE.CylinderGeometry(0.023, 0.041, 1.36, 8);

/** Ground-level physical utility parts. Overhead conductors and insulators are
 * deliberately absent; their rendering must not create a wall across a road. */
function powerObstacles(state: CityState): DrivingCollisionShape[] {
  const layout = getPowerLayout(state),
    root = new THREE.Group();
  root.userData.drivingObstacle = true;
  const centers = new Map<number, THREE.Vector3>();
  const addBox = (x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0) => {
    const mesh = new THREE.Mesh(lampBoxGeometry, collisionMaterial);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.rotation.y = yaw;
    root.add(mesh);
  };
  for (const pole of layout.poles) {
    const offset = state.tiles[pole.id]?.kind === 'road' ? 0.86 : 0.5;
    const x = pole.x - state.size / 2 + offset,
      z = pole.z - state.size / 2 + offset,
      y = pole.elevation;
    centers.set(pole.id, new THREE.Vector3(x, y, z));
    addBox(x, y + 0.037, z, 0.115, 0.074, 0.115);
    const mast = new THREE.Mesh(powerMastGeometry, collisionMaterial);
    mast.position.set(x, y + 0.71, z);
    root.add(mast);
  }
  for (const service of layout.services) {
    const pole = centers.get(service.pole);
    if (!pole) continue;
    const source = ['power', 'wind', 'solar'].includes(state.tiles[service.building].kind);
    const { cabinet } = powerServiceModelPlacement(state, service, pole);
    const { x, y, z } = cabinet,
      height = source ? 0.42 : 0.31,
      width = source ? 0.2 : 0.105,
      depth = source ? 0.16 : 0.07;
    const angle = Math.atan2(pole.x - x, pole.z - z);
    addBox(x, y + 0.025, z, width + 0.055, 0.05, depth + 0.055, angle);
    addBox(x, y + height / 2 + 0.045, z, width, height, depth, angle);
    addBox(x, y + height + 0.055, z, width + 0.022, 0.025, depth + 0.025, angle);
  }
  // Terrain can be negative; do not discard a low valley's poles globally.
  return extractDrivingCollisionShapes(root, -Infinity);
}

/** Split merged render meshes before computing any hull: gaps between separate
 * tyres, pillars or buildings must never become an invisible solid rectangle. */
function components(geometry: THREE.BufferGeometry): Float64Array[] {
  const cached = localComponents.get(geometry);
  if (cached) return cached;
  const position = geometry.getAttribute('position'),
    index = geometry.index;
  if (!position) return [];
  const count = Math.floor((index?.count ?? position.count) / 3);
  const parents = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parents[root] !== root) root = parents[root];
    while (parents[i] !== i) {
      const next = parents[i];
      parents[i] = root;
      i = next;
    }
    return root;
  };
  const vertices = new Map<string, number>();
  for (let triangle = 0; triangle < count; triangle++)
    for (let v = 0; v < 3; v++) {
      const id = index ? index.getX(triangle * 3 + v) : triangle * 3 + v;
      const key = `${Math.round(position.getX(id) * 1e7)},${Math.round(position.getY(id) * 1e7)},${Math.round(position.getZ(id) * 1e7)}`;
      const previous = vertices.get(key);
      if (previous === undefined) vertices.set(key, triangle);
      else parents[find(triangle)] = find(previous);
    }
  const groups = new Map<number, number[]>();
  for (let triangle = 0; triangle < count; triangle++) {
    const root = find(triangle),
      output = groups.get(root) ?? [];
    for (let v = 0; v < 3; v++) {
      const id = index ? index.getX(triangle * 3 + v) : triangle * 3 + v;
      output.push(position.getX(id), position.getY(id), position.getZ(id));
    }
    groups.set(root, output);
  }
  const result = [...groups.values()].map((values) => new Float64Array(values));
  localComponents.set(geometry, result);
  return result;
}

function hull(points: Point2[]): Point2[] {
  points.sort((a, b) => a.x - b.x || a.z - b.z);
  const unique = points.filter(
    (p, i) =>
      !i || Math.abs(p.x - points[i - 1].x) > EPSILON || Math.abs(p.z - points[i - 1].z) > EPSILON,
  );
  if (unique.length < 3) return unique;
  const cross = (a: Point2, b: Point2, c: Point2) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const lower: Point2[] = [],
    upper: Point2[] = [];
  for (const p of unique) {
    while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= EPSILON) lower.pop();
    lower.push(p);
  }
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= EPSILON) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Uses an individual mesh/component, never an entire facility bounding box.
 * Upright boxes retain oriented footprints; other shapes are sliced at body height. */
export function extractDrivingCollisionShapes(
  root: THREE.Object3D,
  groundY = 0,
): DrivingCollisionShape[] {
  root.updateMatrixWorld(true);
  const shapes: DrivingCollisionShape[] = [];
  root.traverseVisible((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      object.userData.buildingWindowLight ||
      object.userData.drivingSurface
    )
      return;
    let parent: THREE.Object3D | null = object,
      isProp = false;
    while (parent && parent !== root.parent) {
      if (parent.userData.vehicleForward || parent.userData.drivingObstacle) isProp = true;
      parent = parent.parent;
    }
    // Instance matrices are not included in matrixWorld. Reading just the mesh
    // transform creates a phantom unit cube and misses every visible instance.
    const matrices: THREE.Matrix4[] = [];
    if (object instanceof THREE.InstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        const instance = new THREE.Matrix4();
        object.getMatrixAt(i, instance);
        matrices.push(new THREE.Matrix4().multiplyMatrices(object.matrixWorld, instance));
      }
    } else matrices.push(object.matrixWorld);
    for (const matrix of matrices) {
      const e = matrix.elements;
      const uprightBox =
        object.geometry.type === 'BoxGeometry' &&
        Math.abs(e[1]) + Math.abs(e[9]) + Math.abs(e[4]) + Math.abs(e[6]) < EPSILON;
      const point = new THREE.Vector3();
      for (const local of components(object.geometry)) {
        const triangles = new Float64Array(local.length);
        const shape: DrivingCollisionShape = {
          triangles,
          minX: Infinity,
          maxX: -Infinity,
          minY: Infinity,
          maxY: -Infinity,
          minZ: Infinity,
          maxZ: -Infinity,
          surface: false,
        };
        const projected: Point2[] = [];
        for (let i = 0; i < local.length; i += 3) {
          point.set(local[i], local[i + 1], local[i + 2]).applyMatrix4(matrix);
          triangles[i] = point.x;
          triangles[i + 1] = point.y;
          triangles[i + 2] = point.z;
          shape.minX = Math.min(shape.minX, point.x);
          shape.maxX = Math.max(shape.maxX, point.x);
          shape.minY = Math.min(shape.minY, point.y);
          shape.maxY = Math.max(shape.maxY, point.y);
          shape.minZ = Math.min(shape.minZ, point.z);
          shape.maxZ = Math.max(shape.maxZ, point.z);
          if (uprightBox) projected.push({ x: point.x, z: point.z });
        }
        // Rendered paving has several layers above the .07 foundation, including
        // the .17 pitch markings. Those thin horizontal sheets support wheels.
        shape.surface =
          !isProp &&
          uprightBox &&
          shape.maxY <= groundY + 0.22 + EPSILON &&
          shape.maxY - shape.minY <= 0.075 + EPSILON;
        // Flat painted rings/decals have no physical volume. In particular the
        // stadium centre-circle must not turn into a solid disk after projection.
        if (!isProp && shape.maxY <= groundY + 0.22 + EPSILON && shape.maxY - shape.minY <= EPSILON)
          continue;
        if (uprightBox) shape.polygon = hull(projected);
        // Low solid stones, fountain rims and trunks still have volume. Only
        // geometry entirely below the terrain can be dropped at extraction.
        if (shape.maxY <= groundY + EPSILON && !shape.surface) continue;
        shapes.push(shape);
      }
    }
  });
  // A thin seat or fence rail is not paving merely because it is low. Raised
  // paving must have another traversable layer directly underneath it; roofs,
  // seats and planter caps over solid walls cannot lift bodies past obstacles.
  const candidates = shapes.filter((shape) => shape.surface);
  for (const shape of candidates) shape.surface = shape.maxY <= groundY + 0.075 + EPSILON;
  candidates.sort((a, b) => a.minY - b.minY);
  for (const shape of candidates) {
    if (shape.surface) continue;
    const x = (shape.minX + shape.maxX) / 2,
      z = (shape.minZ + shape.maxZ) / 2;
    shape.surface = candidates.some(
      (support) =>
        support !== shape &&
        support.surface &&
        support.maxY <= shape.maxY + EPSILON &&
        shape.minY <= support.maxY + 0.025 + EPSILON &&
        polygonIntersectsBody(support.polygon!, x, z, 0, {
          halfWidth: 0,
          halfLength: 0,
          height: 0,
        }),
    );
  }
  return shapes;
}

function slicePolygon(shape: DrivingCollisionShape, minY: number, maxY: number): Point2[] {
  if (shape.polygon) return shape.polygon;
  const points: Point2[] = [],
    vertices = shape.triangles;
  for (let t = 0; t < vertices.length; t += 9) {
    // Clipping every triangle edge captures sloped walls and round trunks at
    // the actual car height, rather than expanding their roof/canopy bounds.
    for (let v = 0; v < 3; v++) {
      const a = t + v * 3,
        b = t + ((v + 1) % 3) * 3;
      const ax = vertices[a],
        ay = vertices[a + 1],
        az = vertices[a + 2];
      const bx = vertices[b],
        by = vertices[b + 1],
        bz = vertices[b + 2];
      if (ay >= minY - EPSILON && ay <= maxY + EPSILON) points.push({ x: ax, z: az });
      for (const y of [minY, maxY])
        if ((ay < y && by > y) || (ay > y && by < y)) {
          const f = (y - ay) / (by - ay);
          points.push({ x: ax + (bx - ax) * f, z: az + (bz - az) * f });
        }
    }
  }
  return hull(points);
}

function polygonIntersectsBody(
  polygon: Point2[],
  x: number,
  z: number,
  yaw: number,
  body: DrivingCollisionDimensions,
): boolean {
  if (!polygon.length) return false;
  const rx = Math.cos(yaw),
    rz = -Math.sin(yaw),
    fx = -rz,
    fz = rx;
  const separated = (nx: number, nz: number): boolean => {
    if (Math.abs(nx) + Math.abs(nz) < EPSILON) return false;
    const radius =
      Math.abs(nx * rx + nz * rz) * body.halfWidth + Math.abs(nx * fx + nz * fz) * body.halfLength;
    let min = Infinity,
      max = -Infinity;
    for (const p of polygon) {
      const projection = (p.x - x) * nx + (p.z - z) * nz;
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }
    return min > radius + EPSILON || max < -radius - EPSILON;
  };
  if (separated(rx, rz) || separated(fx, fz)) return false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (separated(b.z - a.z, a.x - b.x)) return false;
  }
  return true;
}

export function collisionShapeIntersects(
  shape: DrivingCollisionShape,
  x: number,
  z: number,
  yaw: number,
  body: DrivingCollisionDimensions = DEFAULT_BODY,
  groundY = 0,
): boolean {
  if (shape.surface || shape.maxY < groundY + 0.025 || shape.minY > groundY + body.height)
    return false;
  const radius = Math.hypot(body.halfWidth, body.halfLength);
  if (
    x + radius < shape.minX ||
    x - radius > shape.maxX ||
    z + radius < shape.minZ ||
    z - radius > shape.maxZ
  )
    return false;
  return polygonIntersectsBody(
    slicePolygon(shape, groundY + 0.025, groundY + body.height),
    x,
    z,
    yaw,
    body,
  );
}

const treeNoise = (x: number, z: number, seed: number) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 17.77) * 43758.5453;
  return n - Math.floor(n);
};

function streetlightShapes(state: CityState, tile: Tile): DrivingCollisionShape[] {
  const fixture = getRoadStreetlightFixture(state, tile);
  if (!fixture) return [];
  const group = new THREE.Group();
  group.userData.drivingObstacle = true;
  const add = (geometry: THREE.BufferGeometry, position: THREE.Vector3, scale: THREE.Vector3) => {
    const mesh = new THREE.Mesh(geometry, collisionMaterial);
    mesh.position.copy(position);
    mesh.scale.copy(scale);
    group.add(mesh);
    return mesh;
  };
  add(
    lampPoleGeometry,
    fixture.mast.clone().add(new THREE.Vector3(0, fixture.mastHeight / 2, 0)),
    new THREE.Vector3(fixture.mastRadius, fixture.mastHeight, fixture.mastRadius),
  );
  add(
    lampBaseGeometry,
    fixture.base.clone().add(new THREE.Vector3(0, fixture.baseHeight / 2, 0)),
    new THREE.Vector3(fixture.baseRadius, fixture.baseHeight, fixture.baseRadius),
  );
  add(
    lampBoxGeometry,
    fixture.bulb.clone().add(new THREE.Vector3(0, 0.019, 0)),
    new THREE.Vector3(0.095, 0.017, 0.07),
  );
  add(lampBoxGeometry, fixture.bulb, new THREE.Vector3(0.073, 0.024, 0.052));
  const start = fixture.mast.clone().add(new THREE.Vector3(0, 0.46, 0));
  const end = fixture.bulb.clone().add(new THREE.Vector3(0.023, 0.015, 0)),
    delta = end.clone().sub(start);
  const arm = add(
    lampBoxGeometry,
    start.clone().add(end).multiplyScalar(0.5),
    new THREE.Vector3(delta.length(), 0.024, 0.031),
  );
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), delta.normalize());
  // At a steep road join the interpolated deck can be far below tile.elevation.
  // Filtering against the tile centre would discard the entire visible lamp.
  return extractDrivingCollisionShapes(
    group,
    Math.min(fixture.mast.y - 0.045, fixture.bulb.y - 0.49),
  );
}

export function createDrivingCollisionWorld(initialState: CityState): DrivingCollisionWorld {
  let state = initialState;
  let utilityRevision = -1,
    utilitySignature = '';
  const utilityBins = new Map<string, DrivingCollisionShape[]>();
  function nearbyUtilities(x: number, z: number, radius: number) {
    if (utilityRevision !== state.revision) {
      utilityRevision = state.revision;
      const signature = powerLayoutSignature(state);
      if (signature !== utilitySignature) {
        utilitySignature = signature;
        utilityBins.clear();
        for (const shape of powerObstacles(state))
          for (let bz = Math.floor(shape.minZ); bz <= Math.floor(shape.maxZ); bz++)
            for (let bx = Math.floor(shape.minX); bx <= Math.floor(shape.maxX); bx++) {
              const key = `${bx}:${bz}`,
                bin = utilityBins.get(key) ?? [];
              bin.push(shape);
              utilityBins.set(key, bin);
            }
      }
    }
    const result = new Set<DrivingCollisionShape>();
    for (let bz = Math.floor(z - radius); bz <= Math.floor(z + radius); bz++)
      for (let bx = Math.floor(x - radius); bx <= Math.floor(x + radius); bx++)
        for (const shape of utilityBins.get(`${bx}:${bz}`) ?? []) result.add(shape);
    return result;
  }
  const cache = new Map<
    number,
    { signature: string; shapes: DrivingCollisionShape[]; kind: Tile['kind'] }
  >();
  function entry(tile: Tile) {
    const index = tile.z * state.size + tile.x;
    const signature = [
      tile.kind,
      tile.level,
      tile.variation,
      tile.elevation,
      tile.rotation,
      tile.anchor,
      tile.lotWidth,
      tile.lotDepth,
      tile.ruralCommercial,
      tile.zoneDensity,
      tile.kind === 'tree' || tile.kind === 'road'
        ? [-1, 0, 1]
            .flatMap((dz) =>
              [-1, 0, 1].map((dx) => {
                const neighbor =
                  tile.x + dx < 0 ||
                  tile.x + dx >= state.size ||
                  tile.z + dz < 0 ||
                  tile.z + dz >= state.size
                    ? undefined
                    : state.tiles[(tile.z + dz) * state.size + tile.x + dx];
                return `${neighbor?.kind},${neighbor?.elevation}`;
              }),
            )
            .join(';')
        : facilityAccessSignature(state, tile),
    ].join(':');
    let result = cache.get(index);
    if (result?.signature === signature) return result;
    const x = tile.x - state.size / 2 + 0.5,
      z = tile.z - state.size / 2 + 0.5;
    const baseY =
      tile.kind === 'tree' ? sampleGroundHeight(state, x, z) : Math.max(0, tile.elevation);
    let shapes: DrivingCollisionShape[];
    if (tile.kind === 'road') {
      // New fixtures have a shared pure placement API with the renderer. Never
      // regenerate the removed legacy lamp at its former sidewalk position.
      shapes = streetlightShapes(state, tile);
    } else {
      // Fire/smoke are visual effects, not structural collision shapes.
      const model = createTileModel(
        {
          ...tile,
          fire: 0,
          ...(tile.kind === 'tree' ? { variation: Math.abs(tile.variation) % 6 } : {}),
        },
        state,
      );
      model.position.set(x, baseY, z);
      if (tile.kind === 'tree') {
        model.rotation.y = treeNoise(tile.x, tile.z, state.seed) * Math.PI * 2;
        model.scale.setScalar(0.8 + treeNoise(tile.z, tile.x, state.seed) * 0.38);
      }
      shapes = extractDrivingCollisionShapes(model, baseY);
      // Shared render geometry/materials belong to models.ts; do not dispose them.
      model.clear();
    }
    result = { signature, kind: tile.kind, shapes };
    if (cache.size >= 256 && !cache.has(index)) cache.delete(cache.keys().next().value!);
    cache.set(index, result);
    return result;
  }
  function nearby(x: number, z: number, radius: number) {
    const results: ReturnType<typeof entry>[] = [],
      seen = new Set<number>(),
      half = state.size / 2;
    // One neighboring cell catches trunks/facade trim protruding over lot edges.
    const minX = Math.max(0, Math.floor(x + half - radius) - 1),
      maxX = Math.min(state.size - 1, Math.floor(x + half + radius) + 1);
    const minZ = Math.max(0, Math.floor(z + half - radius) - 1),
      maxZ = Math.min(state.size - 1, Math.floor(z + half + radius) + 1);
    for (let tz = minZ; tz <= maxZ; tz++)
      for (let tx = minX; tx <= maxX; tx++) {
        let tile = state.tiles[tz * state.size + tx];
        if (!tile || noModel.has(tile.kind)) continue;
        if (tile.kind === 'road' && (tile.x + tile.z) % 6 !== 0) continue;
        if (tile.anchor >= 0) tile = state.tiles[tile.anchor] ?? tile;
        if (noModel.has(tile.kind)) continue;
        const id = tile.z * state.size + tile.x;
        if (seen.has(id)) continue;
        seen.add(id);
        results.push(entry(tile));
      }
    return results;
  }
  function surfaceHeight(x: number, z: number, baseGroundY: number): number {
    let y = baseGroundY;
    const pointBody = { halfWidth: 0, halfLength: 0, height: 0 };
    for (const model of nearby(x, z, 0))
      for (const shape of model.shapes) {
        if (!shape.surface || shape.maxY <= y || shape.maxY > baseGroundY + 0.22 + EPSILON)
          continue;
        if (x < shape.minX || x > shape.maxX || z < shape.minZ || z > shape.maxZ) continue;
        if (polygonIntersectsBody(shape.polygon!, x, z, 0, pointBody)) y = shape.maxY;
      }
    return y;
  }
  function collides(
    x: number,
    z: number,
    yaw: number,
    body = DEFAULT_BODY,
    groundY?: number,
  ): string | undefined {
    if (![x, z, yaw, body.halfWidth, body.halfLength, body.height].every(Number.isFinite))
      return undefined;
    const y = groundY ?? surfaceHeight(x, z, sampleGroundHeight(state, x, z));
    for (const shape of nearbyUtilities(x, z, Math.hypot(body.halfWidth, body.halfLength)))
      if (collisionShapeIntersects(shape, x, z, yaw, body, y)) return 'Gebäude im Weg';
    for (const model of nearby(x, z, Math.hypot(body.halfWidth, body.halfLength)))
      for (const shape of model.shapes) {
        if (collisionShapeIntersects(shape, x, z, yaw, body, y))
          return model.kind === 'tree' ? 'Baum im Weg' : 'Gebäude im Weg';
      }
    return undefined;
  }
  return {
    setState(next) {
      if (next.size !== state.size || next.seed !== state.seed) {
        cache.clear();
        utilitySignature = '';
      }
      // Worker updates replace arrays even when no visible geometry changed.
      // Per-entry signatures retain those shapes and still detect actual edits.
      if (next.tiles !== state.tiles || next.seed !== state.seed || next.size !== state.size)
        utilityRevision = -1;
      state = next;
    },
    collides,
    tileCollides(tileIndex, x, z, yaw, body = DEFAULT_BODY, groundY) {
      let tile = state.tiles[tileIndex];
      if (!tile || noModel.has(tile.kind)) return undefined;
      if (tile.anchor >= 0) tile = state.tiles[tile.anchor] ?? tile;
      if (noModel.has(tile.kind) || (tile.kind === 'road' && (tile.x + tile.z) % 6 !== 0))
        return undefined;
      const y = groundY ?? sampleGroundHeight(state, x, z);
      return entry(tile).shapes.some((shape) => collisionShapeIntersects(shape, x, z, yaw, body, y))
        ? tile.kind === 'tree'
          ? 'Baum im Weg'
          : 'Gebäude im Weg'
        : undefined;
    },
    getShapesNear(x, z, radius) {
      return [
        ...nearby(x, z, radius).flatMap((model) => model.shapes),
        ...nearbyUtilities(x, z, radius),
      ];
    },
    pointBlocked(x, z, y) {
      return !!collides(x, z, 0, { halfWidth: 0, halfLength: 0, height: DEFAULT_BODY.height }, y);
    },
    surfaceHeight,
    dispose() {
      cache.clear();
      utilityBins.clear();
    },
  };
}
