import * as THREE from 'three';
import type { CityState, Point, Tile } from './types';
import { sampleGroundHeight } from './terrain-graphics';
import { sampleRoadHeight } from './road-graphics';
import { createDrivingCollisionWorld, type DrivingCollisionWorld } from './driving-collisions';
import { findVehicleContact, resolveVehicleContact, sweepVehicleContact, type VehicleContactBody } from './vehicle-contacts';

/** Cars stay owned by the city scene, including their autonomous route. */
export interface DrivableCar {
  model: THREE.Group;
  from: Point;
  to: Point;
  previous?: Point;
  progress: number;
  speed: number;
  turn?: number;
}

export interface DrivingHover { id: number; screenX: number; screenY: number; label: string; }
export interface DrivingStatus { active: boolean; speed: number; label: string; blocked?: string; speedLimit?: number; drifting?: boolean; collisionCount?: number; }
export interface DrivingInput { throttle: number; steer: number; handbrake: boolean; }
export interface VehicleDimensions { width: number; length: number; height: number; wheelBase: number; mass: number; }
export interface VehicleSweep {
  previous: { x: number; y: number; z: number }; current: { x: number; y: number; z: number };
  previousYaw: number; yaw: number; width: number; length: number; height: number;
  velocity: { x: number; y: number; z: number }; vehicleId: number;
}
export interface VehicleCollision {
  vehicleId: number; otherId: number | null;
  point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number }; speed: number;
}
export interface VehicleMotion {
  x: number; z: number; y: number; yaw: number; speed: number;
  steering: number; pitch: number; roll: number;
  vx: number; vz: number; angularVelocity: number; lateralSpeed: number; drifting: boolean;
  blocked?: string; blockedFor: number;
  worldImpact?: Omit<VehicleCollision, 'vehicleId' | 'otherId'>;
}

const STEP = 1 / 120;
const DEFAULT_DIMENSIONS: VehicleDimensions = { width: .183, length: .3385, height: .163, wheelBase: .23, mass: 1 };
const MAX_SPEED = 70 / 36; // One world unit is ten metres. 50 urban / 70 outskirts / 25 off road.
const REVERSE_SPEED = -.68;
const BODY_CLEARANCE = .005;
const driveKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Escape']);
const solidKinds = new Set<Tile['kind']>(['power', 'waterpump', 'police', 'fire', 'hospital', 'school', 'stadium', 'airport', 'seaport', 'wind', 'solar', 'university', 'recycling']);
const zonedKinds = new Set<Tile['kind']>(['residential', 'commercial', 'industrial']);
const clamp = THREE.MathUtils.clamp;
const damp = (current: number, target: number, response: number, dt: number) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-response * dt));
const worlds = new WeakMap<CityState, DrivingCollisionWorld>();

function collisionWorldFor(state: CityState): DrivingCollisionWorld {
  let world = worlds.get(state);
  if (!world) { world = createDrivingCollisionWorld(state); worlds.set(state, world); }
  return world;
}

export function getVehicleDimensions(model: THREE.Group): VehicleDimensions {
  const declared = model.userData.vehicleDimensions ?? {};
  const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
  return {
    width: number(declared.width, DEFAULT_DIMENSIONS.width, .1, .45),
    length: number(declared.length, DEFAULT_DIMENSIONS.length, .18, .9),
    height: number(declared.height, DEFAULT_DIMENSIONS.height, .1, .5),
    wheelBase: number(declared.wheelBase, DEFAULT_DIMENSIONS.wheelBase, .15, .6),
    mass: number(declared.mass, DEFAULT_DIMENSIONS.mass, .5, 4),
  };
}

function tileAtWorld(state: CityState, x: number, z: number): Tile | undefined {
  const tx = Math.floor(x + state.size / 2), tz = Math.floor(z + state.size / 2);
  return tx < 0 || tz < 0 || tx >= state.size || tz >= state.size ? undefined : state.tiles[tz * state.size + tx];
}

/** The same road surface that supports the visible mesh supports its vehicles. */
export function drivingSurfaceHeight(state: CityState, x: number, z: number): number {
  if (tileAtWorld(state, x, z)?.kind === 'road') return sampleRoadHeight(state, x, z) + .052 + BODY_CLEARANCE;
  const base = sampleGroundHeight(state, x, z);
  return collisionWorldFor(state).surfaceHeight(x, z, base) + BODY_CLEARANCE;
}

function pointObstacle(state: CityState, x: number, z: number, y?: number): string | undefined {
  const tile = tileAtWorld(state, x, z);
  if (!tile) return 'Stadtrand erreicht';
  if (tile.kind === 'water' || tile.elevation < 0 && tile.kind !== 'road') return 'Hier ist Wasser';
  if (collisionWorldFor(state).pointBlocked(x, z, y)) return tile.kind === 'tree' ? 'Baum im Weg' : 'Gebäude im Weg';
  return undefined;
}

/** Footprints are a broad phase only: open lots and parking are actually driveable. */
export function drivingObstacle(state: CityState, x: number, z: number, yaw: number, dimensions: VehicleDimensions = DEFAULT_DIMENSIONS): string | undefined {
  const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw), rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  for (const length of [-dimensions.length / 2, 0, dimensions.length / 2]) for (const width of [-dimensions.width / 2, 0, dimensions.width / 2]) {
    const tile = tileAtWorld(state, x + forwardX * length + rightX * width, z + forwardZ * length + rightZ * width);
    if (!tile) return 'Stadtrand erreicht';
    if (tile.kind === 'water' || tile.elevation < 0 && tile.kind !== 'road') return 'Hier ist Wasser';
  }
  return collisionWorldFor(state).collides(x, z, yaw, { halfWidth: dimensions.width / 2, halfLength: dimensions.length / 2, height: dimensions.height }, drivingSurfaceHeight(state, x, z));
}

export function createVehicleMotion(state: CityState, x: number, z: number, yaw = 0): VehicleMotion {
  return { x, z, y: drivingSurfaceHeight(state, x, z), yaw, speed: 0, steering: 0, pitch: 0, roll: 0, blockedFor: 0, vx: 0, vz: 0, angularVelocity: 0, lateralSpeed: 0, drifting: false };
}

/** Signed local velocity is exposed alongside world momentum for impacts and drifting. */
export function setVehicleVelocity(motion: VehicleMotion, vx: number, vz: number): void {
  motion.vx = vx; motion.vz = vz;
  motion.speed = vx * Math.sin(motion.yaw) + vz * Math.cos(motion.yaw);
  motion.lateralSpeed = vx * Math.cos(motion.yaw) - vz * Math.sin(motion.yaw);
}

export function getDrivingSpeedLimit(state: CityState, x: number, z: number): number {
  const tile = tileAtWorld(state, x, z);
  if (!tile || tile.kind !== 'road') return 25;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const xx = tile.x + dx, zz = tile.z + dz;
    if (xx < 0 || zz < 0 || xx >= state.size || zz >= state.size) continue;
    const neighbor = state.tiles[zz * state.size + xx];
    if (solidKinds.has(neighbor.kind) || zonedKinds.has(neighbor.kind) && neighbor.level > 0) return 50;
  }
  return 70;
}

/** Fixed-step bicycle steering, rolling resistance, reverse, braking, and terrain suspension. */
export function stepVehicle(state: CityState, motion: VehicleMotion, input: DrivingInput, dt: number, dimensions: VehicleDimensions = DEFAULT_DIMENSIONS): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  // Bound every sweep even when a caller accidentally passes an entire slow frame.
  if (dt > STEP + 1e-9) {
    let remaining = Math.min(dt, .5);
    while (remaining > 1e-9) { const step = Math.min(STEP, remaining); stepVehicle(state, motion, input, step, dimensions); remaining -= step; }
    return;
  }
  const throttle = clamp(input.throttle, -1, 1), steer = clamp(input.steer, -1, 1);
  motion.worldImpact = undefined;
  motion.blockedFor = Math.max(0, motion.blockedFor - dt);
  if (!motion.blockedFor) motion.blocked = undefined;
  const speedLimit = getDrivingSpeedLimit(state, motion.x, motion.z) / 36;
  const fx = Math.sin(motion.yaw), fz = Math.cos(motion.yaw), rx = Math.cos(motion.yaw), rz = -Math.sin(motion.yaw);
  // Motion vectors survive steering: a rear-wheel lock lets the car rotate while
  // its mass keeps sliding along the previous path instead of turning on rails.
  let forwardSpeed = motion.vx * fx + motion.vz * fz;
  let lateralSpeed = motion.vx * rx + motion.vz * rz;
  let acceleration = 0;
  if (input.handbrake) acceleration = -Math.sign(forwardSpeed) * (Math.abs(steer) > .1 ? .62 : 1.65);
  else if (throttle !== 0) acceleration = throttle * (Math.sign(forwardSpeed) !== Math.sign(throttle) && Math.abs(forwardSpeed) > .04 ? 3.2 : throttle > 0 ? 1.02 : .72);
  else acceleration = -Math.sign(forwardSpeed) * (.15 + Math.abs(forwardSpeed) * .14);
  if (forwardSpeed >= speedLimit && throttle > 0) acceleration = Math.min(0, acceleration);
  const oldSpeed = forwardSpeed;
  forwardSpeed = clamp(forwardSpeed + acceleration * dt, REVERSE_SPEED, MAX_SPEED);
  if ((input.handbrake || throttle === 0) && oldSpeed * forwardSpeed < 0) forwardSpeed = 0;
  if (forwardSpeed > speedLimit) forwardSpeed = Math.max(speedLimit, forwardSpeed - 1.1 * dt);
  const grip = input.handbrake ? .7 : 18;
  lateralSpeed *= Math.exp(-grip * dt);
  const momentumDrag = input.handbrake ? Math.exp(-.28 * dt) : 1;
  motion.vx = (fx * forwardSpeed + rx * lateralSpeed) * momentumDrag;
  motion.vz = (fz * forwardSpeed + rz * lateralSpeed) * momentumDrag;
  motion.steering = damp(motion.steering, steer * .62, 9, dt);
  const steeringAtSpeed = motion.steering / (1 + Math.abs(forwardSpeed) * .7);
  const yawTarget = clamp(Math.tan(steeringAtSpeed) * forwardSpeed / dimensions.wheelBase * (input.handbrake ? 1.65 : 1), input.handbrake ? -3.8 : -2.1, input.handbrake ? 3.8 : 2.1);
  motion.angularVelocity = damp(motion.angularVelocity, yawTarget, input.handbrake ? 3.3 : 10, dt);
  const nextYaw = motion.yaw + motion.angularVelocity * dt;
  const nextX = motion.x + motion.vx * dt;
  const nextZ = motion.z + motion.vz * dt;
  let obstacle = drivingObstacle(state, nextX, nextZ, nextYaw, dimensions);
  // Asphalt is a small traversable curb. Compare the underlying land/deck slope,
  // otherwise that thickness alone would look like a cliff at every road edge.
  const oldSurface = tileAtWorld(state, motion.x, motion.z)?.kind === 'road' ? sampleRoadHeight(state, motion.x, motion.z) : sampleGroundHeight(state, motion.x, motion.z);
  const nextSurface = tileAtWorld(state, nextX, nextZ)?.kind === 'road' ? sampleRoadHeight(state, nextX, nextZ) : sampleGroundHeight(state, nextX, nextZ);
  const distance = Math.hypot(nextX - motion.x, nextZ - motion.z);
  if (!obstacle && distance > 1e-7 && Math.abs(nextSurface - oldSurface) > distance * 2.2 + .00001) obstacle = 'Hang zu steil';
  if (obstacle) {
    motion.blocked = obstacle;
    motion.blockedFor = 1.3;
    // Resolve along the free tangent, which allows brushing a wall instead of
    // the old full-tile invisible hard stop beside a parking place or courtyard.
    const canX = !drivingObstacle(state, nextX, motion.z, motion.yaw, dimensions);
    const canZ = !drivingObstacle(state, motion.x, nextZ, motion.yaw, dimensions);
    const speed = Math.hypot(motion.vx, motion.vz);
    const normal = canX && !canZ ? { x: 0, z: Math.sign(motion.vz) } : canZ && !canX ? { x: Math.sign(motion.vx), z: 0 } : { x: motion.vx / Math.max(speed, .0001), z: motion.vz / Math.max(speed, .0001) };
    const impactSpeed = Math.abs(motion.vx * normal.x + motion.vz * normal.z);
    if (impactSpeed > .12) {
      const support = Math.abs(normal.x * Math.sin(motion.yaw) + normal.z * Math.cos(motion.yaw)) * dimensions.length / 2
        + Math.abs(normal.x * Math.cos(motion.yaw) - normal.z * Math.sin(motion.yaw)) * dimensions.width / 2;
      motion.worldImpact = { speed: impactSpeed, point: { x: motion.x + normal.x * support, y: motion.y + .08, z: motion.z + normal.z * support }, normal: { x: normal.x, y: 0, z: normal.z } };
    }
    if (obstacle !== 'Hang zu steil' && canX !== canZ) {
      if (canX) { motion.x = nextX; motion.vz *= -.12; motion.vx *= .85; }
      else { motion.z = nextZ; motion.vx *= -.12; motion.vz *= .85; }
    } else { motion.vx *= -.1; motion.vz *= -.1; }
    motion.angularVelocity *= .3;
  } else {
    motion.x = nextX; motion.z = nextZ; motion.yaw = nextYaw;
  }

  setVehicleVelocity(motion, motion.vx, motion.vz);
  motion.drifting = Math.abs(motion.lateralSpeed) > .10 && Math.hypot(motion.vx, motion.vz) > .3 && Math.abs(Math.atan2(motion.lateralSpeed, Math.abs(motion.speed))) > .15;
  const facingX = Math.sin(motion.yaw), facingZ = Math.cos(motion.yaw), rightX = Math.cos(motion.yaw), rightZ = -Math.sin(motion.yaw);
  const supportLength = dimensions.wheelBase / 2, supportWidth = dimensions.width * .38;
  const front = drivingSurfaceHeight(state, motion.x + facingX * supportLength, motion.z + facingZ * supportLength);
  const back = drivingSurfaceHeight(state, motion.x - facingX * supportLength, motion.z - facingZ * supportLength);
  const right = drivingSurfaceHeight(state, motion.x + rightX * supportWidth, motion.z + rightZ * supportWidth);
  const left = drivingSurfaceHeight(state, motion.x - rightX * supportWidth, motion.z - rightZ * supportWidth);
  // The wheel support plane clears the exact terrain, including crests between wheel samples.
  const ground = Math.max(drivingSurfaceHeight(state, motion.x, motion.z), (front + back) / 2, (right + left) / 2);
  motion.y = Math.max(ground - .025, damp(motion.y, ground, 20, dt));
  motion.pitch = damp(motion.pitch, clamp(-Math.atan2(front - back, supportLength * 2), -.8, .8), 12, dt);
  motion.roll = damp(motion.roll, clamp(Math.atan2(right - left, supportWidth * 2) - motion.angularVelocity * motion.speed * .02, -.55, .55), 12, dt);
}

interface TrafficRejoin { from: Point; to: Point; progress: number; x: number; z: number; yaw: number; distance: number; }

/** Find the nearest point along a real traffic lane, rather than a tile centre. */
function findTrafficRejoin(state: CityState, x: number, z: number, yaw: number): TrafficRejoin | null {
  let result: TrafficRejoin | null = null, nearest = Infinity;
  const half = state.size / 2;
  for (const tile of state.tiles) {
    if (tile.kind !== 'road') continue;
    const neighbors = [{ x: tile.x + 1, z: tile.z }, { x: tile.x - 1, z: tile.z }, { x: tile.x, z: tile.z + 1 }, { x: tile.x, z: tile.z - 1 }]
      .filter(p => p.x >= 0 && p.z >= 0 && p.x < state.size && p.z < state.size && state.tiles[p.z * state.size + p.x].kind === 'road');
    if (!neighbors.length) continue;
    for (const to of neighbors) {
      const dx = to.x - tile.x, dz = to.z - tile.z;
      const ax = tile.x - half + .5 - dz * .13, az = tile.z - half + .5 + dx * .13;
      const progress = clamp((x - ax) * dx + (z - az) * dz, 0, .9999);
      const px = ax + dx * progress, pz = az + dz * progress;
      const distance = Math.hypot(px - x, pz - z);
      const alignment = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const score = distance + (1 - alignment) * .012;
      if (score >= nearest) continue;
      nearest = score;
      result = { from: { x: tile.x, z: tile.z }, to, progress, x: px, z: pz, yaw: Math.atan2(dx, dz), distance };
    }
  }
  return result;
}

function assignTrafficRoute(state: CityState, car: DrivableCar, route: TrafficRejoin): void {
  car.from = route.from; car.to = route.to; car.previous = { ...route.from }; car.progress = route.progress;
  car.model.position.set(route.x, drivingSurfaceHeight(state, route.x, route.z), route.z);
  car.model.rotation.set(0, route.yaw, 0, 'YXZ');
}

/** Only hands back once the car is already at its lane; never teleports across lots. */
export function handBackToTraffic(state: CityState, car: DrivableCar, x = car.model.position.x, z = car.model.position.z): boolean {
  const route = findTrafficRejoin(state, x, z, car.model.rotation.y);
  if (!route || route.distance > .025) return false;
  assignTrafficRoute(state, car, route);
  return true;
}

export interface DrivingController {
  group: THREE.Group;
  camera: THREE.PerspectiveCamera;
  readonly active: boolean;
  readonly selectedCar: DrivableCar | null;
  controlsCar: (car: DrivableCar) => boolean;
  setState: (state: CityState) => void;
  hover: (raycaster: THREE.Raycaster, camera: THREE.Camera, viewport: { left: number; top: number; width: number; height: number }) => DrivingHover | null;
  leaveHover: () => void;
  clearHover: () => void;
  enter: (id: number) => boolean;
  exit: () => void;
  update: (dt: number) => void;
  keyDown: (code: string) => boolean;
  keyUp: (code: string) => boolean;
  resize: (width: number, height: number) => void;
  getStatus: () => DrivingStatus;
  dispose: () => void;
}

export function createDrivingController(
  initialState: CityState,
  getCars: () => DrivableCar[],
  callbacks: {
    onHover?: (info: DrivingHover | null) => void;
    onStatus?: (status: DrivingStatus) => void;
    onVehicleSweep?: (sweep: VehicleSweep) => void;
    onCollision?: (collision: VehicleCollision) => void;
  } = {},
): DrivingController {
  let state = initialState;
  let cityIdentity = `${initialState.seed}:${initialState.size}`;
  let selected: DrivableCar | null = null, hovered: DrivableCar | null = null;
  let motion: VehicleMotion | null = null;
  let accumulator = 0, elapsed = 0, missedHover = 0, lastStatus = '', lastHover = '';
  let hoverCamera: THREE.Camera | null = null;
  let viewport = { left: 0, top: 0, width: 1, height: 1 };
  let label = '', disposed = false;
  let entryProgress = 1;
  let pointerOverCanvas = false;
  let hoverNear = 0, hoverFar = Infinity;
  let collisionCount = 0;
  interface ControlledCar { motion: VehicleMotion; age: number; route: TrafficRejoin | null; routeTimer: number; }
  const controlled = new Map<DrivableCar, ControlledCar>();
  const seenCarPoses = new Map<DrivableCar, { x: number; z: number; y: number; yaw: number }>();
  const collisionCooldown = new Map<string, number>();
  const keys = new Set<string>();
  const camera = new THREE.PerspectiveCamera(55, 1, .035, Math.max(500, initialState.size * 4));
  camera.name = 'driving-chase-camera';
  const group = new THREE.Group();
  group.name = 'vehicle-selection-glow';
  group.visible = false;
  group.userData.raytracingExclude = true;
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd78a, transparent: true, opacity: .96, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const diskMaterial = new THREE.MeshBasicMaterial({ color: 0xffb95c, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.245, .273, 48), ringMaterial);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(.25, 32), diskMaterial);
  ring.rotation.x = disk.rotation.x = -Math.PI / 2;
  ring.position.y = .018; disk.position.y = .015;
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xffe6aa, transparent: true, opacity: .8, depthWrite: false });
  const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(.215, .18, .365));
  const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
  outline.position.y = .095;
  group.add(ring, disk, outline);
  group.traverse(object => { object.userData.raytracingExclude = true; });
  const cameraLook = new THREE.Vector3();
  const entryCamera = new THREE.Vector3();
  const targetCamera = new THREE.Vector3(), targetLook = new THREE.Vector3(), world = new THREE.Vector3();
  const pickSphere = new THREE.Sphere(new THREE.Vector3(), .20), pickPoint = new THREE.Vector3();
  const hoverRay = new THREE.Ray();

  function vehicleLabel(car: DrivableCar): string {
    return car.model.userData.vehicleLabel ?? `Stadtauto ${String(getCars().indexOf(car) + 1).padStart(2, '0')}`;
  }

  function pickRadius(car: DrivableCar): number {
    const dimensions = getVehicleDimensions(car.model);
    return Math.max(.20, Math.hypot(dimensions.width, dimensions.length) / 2);
  }

  function getStatus(): DrivingStatus {
    return {
      active: !!selected, speed: motion ? Math.round(Math.hypot(motion.vx, motion.vz) * 36) * (motion.speed < -.05 ? -1 : 1) : 0, label,
      speedLimit: motion ? getDrivingSpeedLimit(state, motion.x, motion.z) : 50, drifting: motion?.drifting ?? false, collisionCount,
      ...(motion?.blocked ? { blocked: motion.blocked } : {}),
    };
  }

  function emitStatus(force = false): void {
    const status = getStatus(), signature = JSON.stringify(status);
    if (force || signature !== lastStatus) { lastStatus = signature; callbacks.onStatus?.(status); }
  }

  function clearHover(): void {
    hovered = null; group.visible = false; missedHover = 0; lastHover = '';
    callbacks.onHover?.(null);
  }

  function projectHover(force = false): DrivingHover | null {
    if (!hovered || !hoverCamera || selected) return null;
    world.copy(hovered.model.position); world.y += .43; world.project(hoverCamera);
    if (world.z < -1 || world.z > 1) { clearHover(); return null; }
    const info = { id: hovered.model.id, screenX: viewport.left + (world.x + 1) * viewport.width / 2, screenY: viewport.top + (1 - world.y) * viewport.height / 2, label: vehicleLabel(hovered) };
    const signature = `${info.id}:${Math.round(info.screenX)}:${Math.round(info.screenY)}`;
    if (force || signature !== lastHover) { lastHover = signature; callbacks.onHover?.(info); }
    return info;
  }

  function hover(raycaster: THREE.Raycaster, view: THREE.Camera, bounds: typeof viewport): DrivingHover | null {
    if (selected || disposed) return null;
    pointerOverCanvas = true; hoverRay.copy(raycaster.ray); hoverNear = raycaster.near; hoverFar = raycaster.far;
    hoverCamera = view; viewport = bounds;
    let hit: DrivableCar | null = null, distance = Infinity;
    for (const car of getCars()) {
      if (!car.model.visible) continue;
      pickSphere.center.copy(car.model.position); pickSphere.center.y += getVehicleDimensions(car.model).height / 2; pickSphere.radius = pickRadius(car);
      if (raycaster.ray.intersectSphere(pickSphere, pickPoint)) {
        const d = raycaster.ray.origin.distanceToSquared(pickPoint);
        if (d < raycaster.near ** 2 || d > raycaster.far ** 2) continue;
        if (d < distance) { hit = car; distance = d; }
      }
    }
    if (hit) { const changed = hovered !== hit; hovered = hit; missedHover = 0; group.visible = true; return projectHover(changed); }
    // Crossing from the tiny car to its DOM steering button must not dismiss it.
    if (hovered && !missedHover) missedHover = .8;
    return projectHover();
  }

  function updateCamera(dt: number, snap = false): void {
    if (!motion) return;
    const fx = Math.sin(motion.yaw), fz = Math.cos(motion.yaw);
    const distance = 1.55 + Math.abs(motion.speed) * .20;
    targetLook.set(motion.x + fx * .48, motion.y + .18, motion.z + fz * .48);
    targetCamera.set(motion.x - fx * distance, motion.y + .92 + Math.abs(motion.speed) * .08, motion.z - fz * distance);
    const limit = state.size / 2 - .25;
    targetCamera.x = clamp(targetCamera.x, -limit, limit); targetCamera.z = clamp(targetCamera.z, -limit, limit);
    // Keep the camera in front of the first building behind the vehicle and above hills.
    for (let fraction = .1; fraction <= 1.001; fraction += .1) {
      const x = THREE.MathUtils.lerp(motion.x, targetCamera.x, fraction), z = THREE.MathUtils.lerp(motion.z, targetCamera.z, fraction);
      const obstacle = pointObstacle(state, x, z);
      if (obstacle === 'Gebäude im Weg') {
        targetCamera.x = THREE.MathUtils.lerp(motion.x, targetCamera.x, Math.max(.14, fraction - .12));
        targetCamera.z = THREE.MathUtils.lerp(motion.z, targetCamera.z, Math.max(.14, fraction - .12));
        break;
      }
      targetCamera.y = Math.max(targetCamera.y, sampleGroundHeight(state, x, z) + .48);
    }
    if (snap) { camera.position.copy(targetCamera); cameraLook.copy(targetLook); }
    else if (entryProgress < 1) {
      entryProgress = Math.min(1, entryProgress + dt / .95);
      const ease = 1 - (1 - entryProgress) ** 3;
      camera.position.lerpVectors(entryCamera, targetCamera, ease);
      cameraLook.copy(targetLook);
    }
    else {
      camera.position.lerp(targetCamera, 1 - Math.exp(-6 * dt));
      cameraLook.lerp(targetLook, 1 - Math.exp(-10 * dt));
    }
    camera.position.y = Math.max(camera.position.y, sampleGroundHeight(state, camera.position.x, camera.position.z) + .32);
    camera.lookAt(cameraLook); camera.updateMatrixWorld();
  }

  function enter(id: number): boolean {
    if (disposed || selected) return false;
    const car = getCars().find(car => car.model.id === id);
    if (!car) return false;
    selected = car; label = vehicleLabel(car); keys.clear(); accumulator = 0; collisionCount = 0;
    clearHover();
    const previousControl = controlled.get(car);
    motion = previousControl?.motion ?? createVehicleMotion(state, car.model.position.x, car.model.position.z, car.model.rotation.y);
    if (!previousControl) {
      const speed = state.speed && !car.model.userData.trafficWaiting ? clamp(car.speed, 0, .8) : 0;
      setVehicleVelocity(motion, Math.sin(motion.yaw) * speed, Math.cos(motion.yaw) * speed);
    }
    controlled.delete(car);
    camera.far = Math.max(500, state.size * 4); camera.updateProjectionMatrix();
    updateCamera(0, true);
    if (hoverCamera) {
      hoverCamera.getWorldPosition(entryCamera);
      camera.position.copy(entryCamera); camera.lookAt(cameraLook); camera.updateMatrixWorld(); entryProgress = 0;
    } else entryProgress = 1;
    emitStatus(true);
    return true;
  }

  function exit(): void {
    if (!selected) return;
    // The vehicle remains exactly where the player left it and physically slows
    // down/rejoins a lane. A distant road is never used as a teleport target.
    if (motion) controlled.set(selected, { motion, age: .5, route: null, routeTimer: 0 });
    selected = null; motion = null; keys.clear(); label = '';
    emitStatus(true);
  }

  function controlsCar(car: DrivableCar): boolean { return car === selected || controlled.has(car); }

  function pose(car: DrivableCar) {
    const m = car === selected ? motion : controlled.get(car)?.motion;
    return m ? { x: m.x, y: m.y, z: m.z, yaw: m.yaw } : { x: car.model.position.x, y: car.model.position.y, z: car.model.position.z, yaw: car.model.rotation.y };
  }

  function body(car: DrivableCar): VehicleContactBody {
    const dimensions = getVehicleDimensions(car.model), m = car === selected ? motion : controlled.get(car)?.motion;
    const position = pose(car), speed = state.speed && !car.model.userData.trafficWaiting ? car.speed : 0;
    return {
      ...position, vx: m?.vx ?? Math.sin(position.yaw) * speed, vz: m?.vz ?? Math.cos(position.yaw) * speed,
      angularVelocity: m?.angularVelocity ?? 0, halfWidth: dimensions.width / 2, halfLength: dimensions.length / 2,
      height: dimensions.height, mass: dimensions.mass,
    };
  }

  function applyBody(car: DrivableCar, contactBody: VehicleContactBody): VehicleMotion {
    let m = car === selected ? motion : controlled.get(car)?.motion;
    if (!m) {
      m = createVehicleMotion(state, contactBody.x, contactBody.z, contactBody.yaw);
      controlled.set(car, { motion: m, age: 0, route: null, routeTimer: 0 });
    }
    m.x = contactBody.x; m.z = contactBody.z; m.yaw = contactBody.yaw;
    m.y = Math.max(contactBody.y, drivingSurfaceHeight(state, m.x, m.z));
    m.angularVelocity = contactBody.angularVelocity;
    setVehicleVelocity(m, contactBody.vx, contactBody.vz);
    return m;
  }

  function synchronizeModel(car: DrivableCar, m: VehicleMotion): void {
    car.model.position.set(m.x, m.y, m.z);
    car.model.rotation.set(m.pitch, m.yaw, m.roll, 'YXZ');
    car.model.updateMatrixWorld();
  }

  function emitSweep(car: DrivableCar, previous: { x: number; y: number; z: number; yaw: number }, m: VehicleMotion): void {
    const dimensions = getVehicleDimensions(car.model);
    callbacks.onVehicleSweep?.({
      previous: { x: previous.x, y: previous.y, z: previous.z }, current: { x: m.x, y: m.y, z: m.z }, previousYaw: previous.yaw, yaw: m.yaw,
      width: dimensions.width, length: dimensions.length, height: dimensions.height,
      velocity: { x: m.vx, y: clamp((m.y - previous.y) / STEP, -3, 3), z: m.vz }, vehicleId: car.model.id,
    });
  }

  function emitWorldImpact(car: DrivableCar, m: VehicleMotion): void {
    if (!m.worldImpact) return;
    const key = `world:${car.model.id}`;
    if (elapsed <= (collisionCooldown.get(key) ?? -Infinity)) return;
    collisionCooldown.set(key, elapsed + .6); collisionCount++;
    callbacks.onCollision?.({ vehicleId: car.model.id, otherId: null, ...m.worldImpact });
  }

  function updateRecoveringCars(): void {
    for (const [car, entry] of controlled) {
      const m = entry.motion;
      entry.age += STEP; entry.routeTimer -= STEP;
      let input: DrivingInput = { throttle: 0, steer: 0, handbrake: false };
      if (entry.age > 1.2 && Math.hypot(m.vx, m.vz) < .65) {
        if (entry.routeTimer <= 0) { entry.route = findTrafficRejoin(state, m.x, m.z, m.yaw); entry.routeTimer = .7; }
        const route = entry.route;
        if (route) {
          const distance = Math.hypot(route.x - m.x, route.z - m.z);
          const desiredYaw = distance > .045 ? Math.atan2(route.x + Math.sin(route.yaw) * .35 - m.x, route.z + Math.cos(route.yaw) * .35 - m.z) : route.yaw;
          const delta = Math.atan2(Math.sin(desiredYaw - m.yaw), Math.cos(desiredYaw - m.yaw));
          // Rejoining is deliberately slow and obeys the same world colliders.
          input = { throttle: m.speed < .24 ? .4 : 0, steer: clamp(delta * 1.5, -1, 1), handbrake: false };
          if (distance < .025 && Math.abs(Math.atan2(Math.sin(route.yaw - m.yaw), Math.cos(route.yaw - m.yaw))) < .12) {
            assignTrafficRoute(state, car, route); controlled.delete(car); continue;
          }
          if (Math.abs(delta) > 2.1) input = { throttle: -.22, steer: -Math.sign(delta), handbrake: false };
        }
      }
      stepVehicle(state, m, input, STEP, getVehicleDimensions(car.model));
    }
  }

  function resolveTrafficContacts(previous: Map<DrivableCar, { x: number; y: number; z: number; yaw: number }>, firstSubstep: boolean): void {
    const targets = getCars(), visited = new Set<string>();
    const sources = [...(selected ? [selected] : []), ...controlled.keys()];
    for (const car of sources) for (const other of targets) {
      if (car === other || !other.model.visible) continue;
      const pair = car.model.id < other.model.id ? `${car.model.id}:${other.model.id}` : `${other.model.id}:${car.model.id}`;
      if (visited.has(pair)) continue;
      visited.add(pair);
      const a = body(car), b = body(other);
      const aPrevious = previous.get(car) ?? pose(car);
      const bPrevious = previous.get(other) ?? (firstSubstep ? seenCarPoses.get(other) : undefined) ?? pose(other);
      const originalA = { ...a }, originalB = { ...b };
      let contact = findVehicleContact(a, b);
      if (!contact) {
        const sweep = sweepVehicleContact(aPrevious, a, bPrevious, b);
        if (!sweep) continue;
        const interpolate = (target: VehicleContactBody, start: typeof aPrevious) => {
          target.x = THREE.MathUtils.lerp(start.x, target.x, sweep.time);
          target.z = THREE.MathUtils.lerp(start.z, target.z, sweep.time);
          target.y = THREE.MathUtils.lerp(start.y, target.y, sweep.time);
          const angle = Math.atan2(Math.sin(target.yaw - start.yaw), Math.cos(target.yaw - start.yaw));
          target.yaw = start.yaw + angle * sweep.time;
        };
        interpolate(a, aPrevious); interpolate(b, bPrevious);
        // A tiny overlap makes the conservative first-contact sample resolvable.
        a.x += sweep.normal.x * .000001; a.z += sweep.normal.z * .000001;
        b.x -= sweep.normal.x * .000001; b.z -= sweep.normal.z * .000001;
        contact = findVehicleContact(a, b);
      }
      if (!contact) continue;
      const resolution = resolveVehicleContact(a, b);
      if (!resolution) continue;
      // A vehicle pressed against a real wall must not be corrected into it.
      for (const [vehicle, next, original] of [[car, a, originalA], [other, b, originalB]] as const) {
        if (drivingObstacle(state, next.x, next.z, next.yaw, getVehicleDimensions(vehicle.model))) {
          next.x = original.x; next.z = original.z; next.yaw = original.yaw;
          next.vx *= .1; next.vz *= .1;
        }
      }
      const aMotion = applyBody(car, a), bMotion = applyBody(other, b);
      if (!previous.has(other)) previous.set(other, bPrevious);
      if (resolution.closingSpeed > .06 || resolution.impulse > .02) for (const affected of [car, other]) {
        const entry = controlled.get(affected);
        if (entry) { entry.age = 0; entry.route = null; }
      }
      const cooldown = collisionCooldown.get(pair) ?? -Infinity;
      if (resolution.closingSpeed > .06 && elapsed > cooldown) {
        collisionCooldown.set(pair, elapsed + .45);
        collisionCount++;
        aMotion.blocked = bMotion.blocked = 'Zusammenstoß'; aMotion.blockedFor = bMotion.blockedFor = 1.25;
        bMotion.roll = clamp(bMotion.roll + resolution.impulse * (resolution.contact.normal.x || .4) * .2, -.32, .32);
        callbacks.onCollision?.({
          vehicleId: car.model.id, otherId: other.model.id,
          point: { x: resolution.contact.point.x, y: Math.max(a.y, b.y) + .08, z: resolution.contact.point.z },
          normal: { x: resolution.contact.normal.x, y: 0, z: resolution.contact.normal.z }, speed: resolution.closingSpeed,
        });
      }
    }
  }

  function update(dt: number): void {
    if (disposed || !Number.isFinite(dt) || dt < 0) return;
    dt = Math.min(dt, .25); elapsed += dt;
    const currentCars = getCars();
    if (selected && !currentCars.includes(selected)) exit();
    for (const car of controlled.keys()) if (!currentCars.includes(car)) controlled.delete(car);
    for (const car of seenCarPoses.keys()) if (!currentCars.includes(car)) seenCarPoses.delete(car);
    if (hovered && !currentCars.includes(hovered)) clearHover();
    if (hovered) {
      const hoverDimensions = getVehicleDimensions(hovered.model);
      world.copy(hovered.model.position); world.y += hoverDimensions.height / 2;
      pickSphere.radius = pickRadius(hovered);
      pickSphere.center.copy(world);
      const hit = hoverRay.intersectSphere(pickSphere, pickPoint);
      const hitDistance = hit ? hoverRay.origin.distanceToSquared(hit) : Infinity;
      if (pointerOverCanvas && hit && hitDistance >= hoverNear ** 2 && hitDistance <= hoverFar ** 2) missedHover = 0;
      else if (!missedHover) missedHover = .8;
      if (missedHover > 0) { missedHover -= dt; if (missedHover <= 0) clearHover(); }
      if (hovered) {
        group.position.copy(hovered.model.position); group.rotation.y = hovered.model.rotation.y;
        const haloScale = Math.max(.273, hoverDimensions.length / 2 + .08) / .273;
        ring.scale.setScalar(haloScale); disk.scale.setScalar(haloScale);
        outline.scale.set(hoverDimensions.width / .183, hoverDimensions.height / .163, hoverDimensions.length / .3385);
        outline.position.y = hoverDimensions.height / 2 + .01;
        ringMaterial.opacity = .8 + Math.sin(elapsed * 5) * .16;
        diskMaterial.opacity = .11 + Math.sin(elapsed * 5) * .035;
        projectHover();
      }
    }
    if (!selected && !controlled.size) {
      for (const car of currentCars) seenCarPoses.set(car, pose(car));
      return;
    }
    const input = {
      throttle: Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')),
      steer: Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight')),
      handbrake: keys.has('Space'),
    };
    accumulator += dt;
    let firstSubstep = true;
    while (accumulator + 1e-9 >= STEP) {
      const previous = new Map<DrivableCar, { x: number; y: number; z: number; yaw: number }>();
      if (selected) previous.set(selected, pose(selected));
      for (const car of controlled.keys()) previous.set(car, pose(car));
      if (selected && motion) stepVehicle(state, motion, input, STEP, getVehicleDimensions(selected.model));
      updateRecoveringCars();
      resolveTrafficContacts(previous, firstSubstep);
      if (selected && motion) {
        const start = previous.get(selected);
        if (start) emitSweep(selected, start, motion);
        emitWorldImpact(selected, motion);
        synchronizeModel(selected, motion);
      }
      for (const [car, entry] of controlled) {
        const start = previous.get(car);
        if (start) emitSweep(car, start, entry.motion);
        emitWorldImpact(car, entry.motion);
        synchronizeModel(car, entry.motion);
      }
      accumulator -= STEP; firstSubstep = false;
    }
    for (const car of currentCars) seenCarPoses.set(car, pose(car));
    if (selected) updateCamera(dt);
    emitStatus();
  }

  return {
    group, camera,
    get active() { return !!selected; },
    get selectedCar() { return selected; },
    controlsCar,
    setState(next) {
      const nextIdentity = `${next.seed}:${next.size}`;
      if (next !== state || nextIdentity !== cityIdentity) { exit(); controlled.clear(); seenCarPoses.clear(); collisionCooldown.clear(); accumulator = 0; }
      cityIdentity = nextIdentity;
      state = next; collisionWorldFor(next).setState(next); camera.far = Math.max(500, next.size * 4); camera.updateProjectionMatrix();
    },
    hover, leaveHover() { pointerOverCanvas = false; if (hovered) missedHover = .8; }, clearHover, enter, exit, update, getStatus,
    keyDown(code) {
      if (!selected || !driveKeys.has(code)) return false;
      if (code === 'Escape') exit(); else keys.add(code);
      return true;
    },
    keyUp(code) { const handled = !!selected && driveKeys.has(code); keys.delete(code); return handled; },
    resize(width, height) { camera.aspect = Math.max(1, width) / Math.max(1, height); camera.updateProjectionMatrix(); },
    dispose() {
      if (disposed) return;
      exit(); controlled.clear(); seenCarPoses.clear(); collisionCooldown.clear(); clearHover(); disposed = true; group.removeFromParent();
      ring.geometry.dispose(); disk.geometry.dispose(); outlineGeometry.dispose();
      ringMaterial.dispose(); diskMaterial.dispose(); outlineMaterial.dispose();
    },
  };
}
