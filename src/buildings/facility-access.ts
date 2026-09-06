import { zoneLotDimensions } from './lots';
import type { CityState, Point, Tile, TileKind } from '../domain/types';
import { sampleRoadHeight } from '../rendering/infrastructure/roads';
import { lanePose } from '../traffic/lanes';

/** Saved footprints never move. Content is inset to leave a real vehicle-width
 * service drive inside the original property, including on its back and sides. */
export const FACILITY_ACCESS_FOOTPRINTS: Partial<Record<TileKind, readonly [number, number]>> = {
  industrial: [1, 1],
  power: [4, 4],
  waterpump: [2, 2],
  police: [2, 2],
  fire: [3, 2],
  hospital: [3, 3],
  school: [3, 2],
  university: [5, 4],
  stadium: [6, 5],
  airport: [10, 6],
  seaport: [5, 3],
  wind: [2, 2],
  solar: [4, 3],
  recycling: [3, 3],
};
export const FACILITY_PAVEMENT_HEIGHT = 0.052;
export const FACILITY_ACCESS_WIDTH = 0.44;
export type AccessPoint = Point & { y: number };
export interface FacilityAccessSegment {
  a: AccessPoint;
  b: AccessPoint;
  width: number;
}
export interface FacilityAccessPlan {
  id: string;
  anchor: Point;
  kind: TileKind;
  connected: boolean;
  center: Point;
  baseY: number;
  localWidth: number;
  localDepth: number;
  width: number;
  depth: number;
  rotation: number;
  laneWidth: number;
  contentScale: Point;
  contentOffsetZ?: number;
  frontageZ: number;
  points: AccessPoint[];
  renderSegments: FacilityAccessSegment[];
  routeSegments: FacilityAccessSegment[];
  road: Point | null;
  previous: Point | null;
  to: Point | null;
  signature: string;
}
export interface FacilityServiceRoute {
  id: string;
  kind: 'firetruck' | 'ambulance' | 'police';
  connected: boolean;
  points: AccessPoint[];
  spawn: AccessPoint;
  yaw: number;
  road: Point | null;
  previous: Point | null;
  to: Point | null;
  progress: 0;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const tileAt = (state: CityState, x: number, z: number) =>
  x >= 0 && z >= 0 && x < state.size && z < state.size
    ? state.tiles[z * state.size + x]
    : undefined;
const cache = new WeakMap<
  CityState,
  Map<number, { signature: string; plan: FacilityAccessPlan | null }>
>();
export function facilityAccessSignature(state: CityState, tile: Tile): string {
  const root = tile.anchor >= 0 ? (state.tiles[tile.anchor] ?? tile) : tile;
  const dimensions =
    root.kind === 'industrial' && root.lotWidth
      ? zoneLotDimensions(root)
      : FACILITY_ACCESS_FOOTPRINTS[root.kind];
  if (!dimensions) return '';
  const [w, d] = !root.lotWidth && root.rotation % 2 ? [dimensions[1], dimensions[0]] : dimensions;
  let signature = `${root.kind}:${root.level}:${root.x}:${root.z}:${root.rotation}:${root.lotWidth}:${root.lotDepth}:${root.elevation}:${state.size}`;
  // Include the complete halo because road corner heights use all touching roads.
  for (let z = root.z - 2; z <= root.z + d + 1; z++)
    for (let x = root.x - 2; x <= root.x + w + 1; x++) {
      const t = tileAt(state, x, z);
      signature += `|${t?.kind}:${t?.elevation}`;
    }
  return signature;
}
export function facilityLocalToWorld(
  plan: Pick<FacilityAccessPlan, 'center' | 'rotation'>,
  point: Point,
): Point {
  const angle = (-plan.rotation * Math.PI) / 2,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    x: plan.center.x + c * point.x + s * point.z,
    z: plan.center.z - s * point.x + c * point.z,
  };
}
export function facilityWorldToLocal(
  plan: Pick<FacilityAccessPlan, 'center' | 'rotation'>,
  point: Point,
): Point {
  const angle = (-plan.rotation * Math.PI) / 2,
    c = Math.cos(angle),
    s = Math.sin(angle),
    x = point.x - plan.center.x,
    z = point.z - plan.center.z;
  return { x: c * x - s * z, z: s * x + c * z };
}
function perimeterCoordinate(point: Point, rx: number, rz: number): number {
  if (Math.abs(point.z - rz) < 1e-7) return point.x + rx;
  if (Math.abs(point.x - rx) < 1e-7) return 2 * rx + rz - point.z;
  if (Math.abs(point.z + rz) < 1e-7) return 2 * rx + 2 * rz + rx - point.x;
  return 4 * rx + 2 * rz + point.z + rz;
}
function perimeterPoint(t: number, rx: number, rz: number): Point {
  const length = 4 * (rx + rz);
  t = ((t % length) + length) % length;
  if (t <= 2 * rx) return { x: -rx + t, z: rz };
  t -= 2 * rx;
  if (t <= 2 * rz) return { x: rx, z: rz - t };
  t -= 2 * rz;
  if (t <= 2 * rx) return { x: rx - t, z: -rz };
  t -= 2 * rx;
  return { x: -rx, z: -rz + t };
}
function routeAlongPerimeter(
  start: Point,
  end: Point,
  rx: number,
  rz: number,
  minimumLength = 0,
): Point[] {
  const a = perimeterCoordinate(start, rx, rz),
    b = perimeterCoordinate(end, rx, rz),
    length = 4 * (rx + rz);
  const forward = (b - a + length) % length;
  let delta = forward <= length / 2 ? forward : forward - length;
  if (Math.abs(delta) + 1e-7 < minimumLength)
    delta = forward <= length / 2 ? forward - length : forward;
  const points = [start],
    steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.035));
  for (let i = 1; i <= steps; i++) points.push(perimeterPoint(a + (delta * i) / steps, rx, rz));
  return points;
}
function densify(points: Point[], step = 0.035): Point[] {
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      count = Math.max(1, Math.ceil(distance(a, b) / step));
    for (let j = 1; j <= count; j++)
      result.push({ x: a.x + ((b.x - a.x) * j) / count, z: a.z + ((b.z - a.z) * j) / count });
  }
  return result;
}
/** Pure, deterministic access planning; even in-place neighbor edits invalidate it. */
export function getFacilityAccess(state: CityState, tile: Tile): FacilityAccessPlan | null {
  const root = tile.anchor >= 0 ? (state.tiles[tile.anchor] ?? tile) : tile;
  const dimensions =
    root.kind === 'industrial' && root.lotWidth
      ? zoneLotDimensions(root)
      : FACILITY_ACCESS_FOOTPRINTS[root.kind];
  if (!dimensions || (root.kind === 'industrial' && !root.level)) return null;
  const id = root.z * state.size + root.x,
    signature = facilityAccessSignature(state, root);
  let entries = cache.get(state);
  if (!entries) {
    entries = new Map();
    cache.set(state, entries);
  }
  const prior = entries.get(id);
  if (prior?.signature === signature) return prior.plan;
  const [localWidth, localDepth] = dimensions,
    [width, depth] = !root.lotWidth && root.rotation % 2 ? [localDepth, localWidth] : dimensions;
  const baseY = Math.max(0, root.elevation),
    center = { x: root.x - state.size / 2 + width / 2, z: root.z - state.size / 2 + depth / 2 };
  const plan: FacilityAccessPlan = {
    id: `facility:${id}`,
    anchor: { x: root.x, z: root.z },
    kind: root.kind,
    connected: false,
    center,
    baseY,
    localWidth,
    localDepth,
    width,
    depth,
    rotation: root.lotWidth ? 0 : root.rotation,
    laneWidth: FACILITY_ACCESS_WIDTH,
    contentScale: { x: (localWidth - 0.8) / localWidth, z: (localDepth - 0.8) / localDepth },
    frontageZ: localDepth / 2 - 0.22,
    points: [],
    renderSegments: [],
    routeSegments: [],
    road: null,
    previous: null,
    to: null,
    signature,
  };
  if (root.kind === 'industrial' && !root.lotWidth) {
    plan.laneWidth = 0.38;
    plan.contentScale = { x: 1, z: 0.73 };
    plan.contentOffsetZ = -0.2;
    plan.frontageZ = 0.3;
    const sides = [
      { x: 0, z: 1, rotation: 0 },
      { x: 1, z: 0, rotation: 3 },
      { x: 0, z: -1, rotation: 2 },
      { x: -1, z: 0, rotation: 1 },
    ];
    const selected = sides
      .filter((side) => tileAt(state, root.x + side.x, root.z + side.z)?.kind === 'road')
      .sort(
        (a, b) =>
          Math.abs(Math.max(0, tileAt(state, root.x + a.x, root.z + a.z)!.elevation) - baseY) -
          Math.abs(Math.max(0, tileAt(state, root.x + b.x, root.z + b.z)!.elevation) - baseY),
      )[0];
    if (selected) {
      plan.rotation = selected.rotation;
      plan.connected = true;
      plan.road = { x: root.x + selected.x, z: root.z + selected.z };
      plan.previous = { x: root.x, z: root.z };
      plan.to =
        [
          { x: plan.road.x + selected.x, z: plan.road.z + selected.z },
          { x: plan.road.x + selected.z, z: plan.road.z - selected.x },
          { x: plan.road.x - selected.z, z: plan.road.z + selected.x },
        ].find((p) => tileAt(state, p.x, p.z)?.kind === 'road') ?? null;
      const pose = lanePose(
        plan.previous,
        plan.road,
        plan.to ?? { x: plan.road.x + selected.x, z: plan.road.z + selected.z },
        0,
      );
      const end = { x: pose.x - state.size / 2, z: pose.z - state.size / 2 },
        localEnd = facilityWorldToLocal(plan, end);
      const start = facilityLocalToWorld(plan, { x: localEnd.x, z: plan.frontageZ });
      const endY =
        sampleRoadHeight(state, end.x + selected.x * 1e-6, end.z + selected.z * 1e-6) +
        FACILITY_PAVEMENT_HEIGHT;
      if (Math.abs(endY - baseY - FACILITY_PAVEMENT_HEIGHT) * 1.5 > distance(start, end) * 2.0) {
        plan.connected = false;
        plan.to = null;
        plan.points = [{ ...start, y: baseY + 0.026 }];
        entries.set(id, { signature, plan });
        return plan;
      }
      plan.points = densify([start, end]).map((p, i, all) => {
        const t = i / (all.length - 1),
          blend = t * t * (3 - 2 * t);
        return {
          ...p,
          y: baseY + FACILITY_PAVEMENT_HEIGHT + (endY - baseY - FACILITY_PAVEMENT_HEIGHT) * blend,
        };
      });
      for (let i = 1; i < plan.points.length; i++)
        plan.routeSegments.push({
          a: plan.points[i - 1],
          b: plan.points[i],
          width: plan.laneWidth,
        });
      plan.renderSegments = [{ a: plan.points[0], b: plan.points.at(-1)!, width: plan.laneWidth }];
    } else plan.points = [{ ...facilityLocalToWorld(plan, { x: 0, z: 0.3 }), y: baseY + 0.026 }];
    entries.set(id, { signature, plan });
    return plan;
  }
  const rx = localWidth / 2 - 0.22,
    rz = localDepth / 2 - 0.22,
    start = { x: 0, z: rz };
  const candidates: {
    road: Tile;
    inside: Point;
    local: Point;
    gate: Point;
    end: Point;
    to: Point | null;
    score: number;
  }[] = [];
  for (let z = root.z - 1; z <= root.z + depth; z++)
    for (let x = root.x - 1; x <= root.x + width; x++) {
      const road = tileAt(state, x, z);
      if (road?.kind !== 'road') continue;
      const sideX = x === root.x - 1 ? -1 : x === root.x + width ? 1 : 0,
        sideZ = z === root.z - 1 ? -1 : z === root.z + depth ? 1 : 0;
      if (Number(!!sideX) + Number(!!sideZ) !== 1) continue;
      const inside = { x: x - sideX, z: z - sideZ };
      if (
        inside.x < root.x ||
        inside.x >= root.x + width ||
        inside.z < root.z ||
        inside.z >= root.z + depth
      )
        continue;
      const neighbors = [
        { x: x + 1, z },
        { x: x - 1, z },
        { x, z: z + 1 },
        { x, z: z - 1 },
      ].filter((p) => tileAt(state, p.x, p.z)?.kind === 'road');
      // Prefer forward continuation; otherwise turn onto an existing road arm.
      neighbors.sort(
        (a, b) => (b.x - x) * sideX + (b.z - z) * sideZ - ((a.x - x) * sideX + (a.z - z) * sideZ),
      );
      const to = neighbors[0] ?? null,
        pose = lanePose(inside, road, to ?? { x: x + sideX, z: z + sideZ }, 0);
      const end = { x: pose.x - state.size / 2, z: pose.z - state.size / 2 };
      const local = facilityWorldToLocal(plan, end);
      const gate = { x: clamp(local.x, -rx, rx), z: clamp(local.z, -rz, rz) };
      // Project explicitly to the property's perimeter in local coordinates.
      const nx = Math.abs(local.x) / (localWidth / 2),
        nz = Math.abs(local.z) / (localDepth / 2);
      if (nx > nz) gate.x = Math.sign(local.x) * rx;
      else gate.z = Math.sign(local.z) * rz;
      const ringLength = 4 * (rx + rz),
        a = perimeterCoordinate(start, rx, rz),
        b = perimeterCoordinate(gate, rx, rz),
        d = Math.abs(a - b);
      const travel = Math.min(d, ringLength - d);
      const roadY =
        sampleRoadHeight(state, end.x + sideX * 1e-5, end.z + sideZ * 1e-5) +
        FACILITY_PAVEMENT_HEIGHT;
      candidates.push({
        road,
        inside,
        local,
        gate,
        end,
        to,
        score: travel + (to ? 0 : 20) + Math.abs(roadY - baseY - FACILITY_PAVEMENT_HEIGHT) * 3,
      });
    }
  candidates.sort((a, b) => a.score - b.score || a.road.z - b.road.z || a.road.x - b.road.x);
  const chosen = candidates[0];
  if (chosen) {
    plan.connected = true;
    plan.road = { x: chosen.road.x, z: chosen.road.z };
    plan.previous = chosen.inside;
    plan.to = chosen.to;
    const toward = { x: chosen.road.x - chosen.inside.x, z: chosen.road.z - chosen.inside.z };
    const endY =
      sampleRoadHeight(state, chosen.end.x + toward.x * 1e-6, chosen.end.z + toward.z * 1e-6) +
      FACILITY_PAVEMENT_HEIGHT;
    const heightDelta = Math.abs(endY - baseY - FACILITY_PAVEMENT_HEIGHT),
      minimumLength = (heightDelta * 1.5) / 1.6;
    let localPath = routeAlongPerimeter(start, chosen.gate, rx, rz);
    const routeLength = (points: Point[]) =>
      points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
    const gateLength = distance(facilityLocalToWorld(plan, chosen.gate), chosen.end);
    if (routeLength(localPath) + gateLength < minimumLength) {
      // A higher property needs a longer ramp. Move its service bay along the
      // front and use the other perimeter direction before declaring it usable.
      const longerStart = { x: (chosen.gate.x >= 0 ? -1 : 1) * rx * 0.7, z: rz };
      localPath = routeAlongPerimeter(longerStart, chosen.gate, rx, rz, minimumLength - gateLength);
    }
    if (routeLength(localPath) + gateLength + 1e-7 < minimumLength) {
      plan.connected = false;
      plan.to = null;
      plan.points = [{ ...facilityLocalToWorld(plan, start), y: baseY + 0.095 }];
      entries.set(id, { signature, plan });
      return plan;
    }
    const worldPath = localPath.map((p) => facilityLocalToWorld(plan, p));
    worldPath.push(chosen.end);
    const dense = densify(worldPath),
      remaining = new Array<number>(dense.length).fill(0);
    for (let i = dense.length - 2; i >= 0; i--)
      remaining[i] = remaining[i + 1] + distance(dense[i], dense[i + 1]);
    // Spread elevation change along the last .7 mappable units, not the tiny
    // original foundation lip. Smooth ends make entering/exiting symmetric.
    const rampLength = Math.min(
      Math.max(0.7, Math.abs(endY - baseY - FACILITY_PAVEMENT_HEIGHT) * 1.6),
      Math.max(0.22, remaining[0]),
    );
    plan.points = dense.map((p, i) => {
      const t = clamp(1 - remaining[i] / rampLength, 0, 1),
        blend = t * t * (3 - 2 * t);
      return {
        ...p,
        y: baseY + FACILITY_PAVEMENT_HEIGHT + (endY - baseY - FACILITY_PAVEMENT_HEIGHT) * blend,
      };
    });
    const corners = [
      { x: -rx, z: rz },
      { x: rx, z: rz },
      { x: rx, z: -rz },
      { x: -rx, z: -rz },
      { x: -rx, z: rz },
    ].map((p) => ({ ...facilityLocalToWorld(plan, p), y: baseY + FACILITY_PAVEMENT_HEIGHT }));
    for (let i = 1; i < corners.length; i++)
      plan.renderSegments.push({ a: corners[i - 1], b: corners[i], width: FACILITY_ACCESS_WIDTH });
    for (let i = 1; i < plan.points.length; i++)
      plan.routeSegments.push({
        a: plan.points[i - 1],
        b: plan.points[i],
        width: FACILITY_ACCESS_WIDTH,
      });
    // The four full perimeter strips already cover the in-lot route.
    const gateWorld = {
      ...facilityLocalToWorld(plan, chosen.gate),
      y: baseY + FACILITY_PAVEMENT_HEIGHT,
    };
    plan.renderSegments.push({
      a: gateWorld,
      b: plan.points.at(-1)!,
      width: FACILITY_ACCESS_WIDTH,
    });
  } else plan.points = [{ ...facilityLocalToWorld(plan, start), y: baseY + 0.095 }];
  entries.set(id, { signature, plan });
  return plan;
}
function nearestOnSegments(
  segments: FacilityAccessSegment[],
  x: number,
  z: number,
): { distance: number; y: number } | null {
  let nearest: { distance: number; y: number } | null = null;
  for (const { a, b } of segments) {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      length2 = dx * dx + dz * dz,
      t = length2 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / length2, 0, 1) : 0;
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (!nearest || d < nearest.distance - 1e-9)
      nearest = { distance: d, y: a.y + (b.y - a.y) * t };
  }
  return nearest;
}
/** Visible top of the same continuous paved drive used by vehicle suspension.
 * A shoulder blends the ramp into the forecourt; the full vehicle track stays flat. */
export function sampleFacilityAccessHeight(
  plan: FacilityAccessPlan,
  x: number,
  z: number,
): number | null {
  if (!plan.connected) return null;
  // The apron ends exactly at the property edge. Round closest-segment caps
  // must never paint an invisible uphill lip over the adjacent road.
  if (
    x < plan.center.x - plan.width / 2 - 1e-7 ||
    x > plan.center.x + plan.width / 2 + 1e-7 ||
    z < plan.center.z - plan.depth / 2 - 1e-7 ||
    z > plan.center.z + plan.depth / 2 + 1e-7
  )
    return null;
  const nearby = nearestOnSegments(plan.renderSegments, x, z);
  if (!nearby || nearby.distance > plan.laneWidth / 2 + 0.005) return null;
  const path = nearestOnSegments(plan.routeSegments, x, z);
  if (!path || path.distance > plan.laneWidth / 2) return plan.baseY + FACILITY_PAVEMENT_HEIGHT;
  // Adjacent ramp arms meet at a bend. Selecting just the closest arm creates
  // a height jump on its bisector, so blend both sides continuously. At the
  // route centerline the inverse-distance limit retains the exact route height.
  let weighted = 0,
    weights = 0;
  for (const { a, b } of plan.routeSegments) {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      len = dx * dx + dz * dz;
    const t = len ? clamp(((x - a.x) * dx + (z - a.z) * dz) / len, 0, 1) : 0;
    const d2 = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
    if (d2 > 0.09) continue;
    if (d2 < 1e-16) {
      weighted = a.y + (b.y - a.y) * t;
      weights = 1;
      break;
    }
    const weight = (1 - d2 / 0.09) ** 2 / (d2 + 1e-12) ** 2;
    weighted += (a.y + (b.y - a.y) * t) * weight;
    weights += weight;
  }
  const height = weights ? weighted / weights : path.y;
  const weight = clamp((plan.laneWidth / 2 - path.distance) / 0.055, 0, 1);
  return (
    plan.baseY +
    FACILITY_PAVEMENT_HEIGHT +
    (height - plan.baseY - FACILITY_PAVEMENT_HEIGHT) * weight
  );
}
export function sampleFacilityAccessAt(state: CityState, x: number, z: number): number | null {
  const gx = Math.floor(x + state.size / 2),
    gz = Math.floor(z + state.size / 2),
    seen = new Set<number>();
  if (tileAt(state, gx, gz)?.kind === 'road') return null;
  let result: number | null = null;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const tile = tileAt(state, gx + dx, gz + dz);
      if (!tile || !FACILITY_ACCESS_FOOTPRINTS[tile.kind]) continue;
      const id = tile.anchor >= 0 ? tile.anchor : tile.z * state.size + tile.x;
      if (seen.has(id)) continue;
      seen.add(id);
      const plan = getFacilityAccess(state, tile);
      if (!plan) continue;
      const y = sampleFacilityAccessHeight(plan, x, z);
      if (y !== null) result = result === null ? y : Math.max(result, y);
    }
  return result;
}
export function listFacilityServiceRoutes(state: CityState): FacilityServiceRoute[] {
  const result: FacilityServiceRoute[] = [];
  for (const tile of state.tiles) {
    if (
      !['fire', 'hospital', 'police'].includes(tile.kind) ||
      (tile.anchor >= 0 && tile.anchor !== tile.z * state.size + tile.x)
    )
      continue;
    const plan = getFacilityAccess(state, tile)!;
    const points = plan.points.map((p) => ({ ...p, y: p.y + 0.005 })),
      spawn = points[0],
      next = points[1] ?? { ...spawn, z: spawn.z + 1 };
    result.push({
      id: plan.id,
      kind: tile.kind === 'fire' ? 'firetruck' : tile.kind === 'hospital' ? 'ambulance' : 'police',
      connected: plan.connected && !!plan.to,
      points,
      spawn,
      yaw: Math.atan2(next.x - spawn.x, next.z - spawn.z),
      road: plan.road,
      previous: plan.previous,
      to: plan.to,
      progress: 0,
    });
  }
  return result;
}
