import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as CANNON from 'cannon-es';
import { citizenLimbJoint, createCitizenMaterials, createCitizenShoeGeometry } from './appearance';
import {
  citizenScreenHeight,
  citizenUsesDetail,
  createCitizenLodGeometries,
} from './appearance-lod';
import {
  ImpactDebris,
  DISMEMBERMENT_SPEED,
  VEHICLE_DISMEMBERMENT_SPEED,
  CITIZEN_WORLD_GRAVITY,
  CITIZEN_AIR_DAMPING,
} from './impact-debris';
import { createTileModel } from '../rendering/buildings/models';
import { createDrivingCollisionWorld } from '../vehicles/collisions';
import { facilityAccessSignature } from '../buildings/facility-access';
import { sampleGroundHeight } from '../rendering/world/terrain';
import { createPedestrianGraph, type PedestrianGraph } from './routing';
import { createCitizenLife } from './life';
import { createCitizenEventVenue, disposeCitizenEventVenue } from './event-venue';
import { ThrowGesture } from './throw-gesture';
import { createDoubleEagleGeometry, heritageAppearance } from './heritage-apparel';
import type {
  CitizenEventKind,
  CitizenEventResult,
  CitizenLifeSnapshot,
} from '../domain/citizen-life';
import {
  createCitizenSpeechSelector,
  type CitizenDialogueTopic,
  type CitizenDialoguePair,
} from './dialogue/catalog';
import { tr } from '../i18n/index';
import type { CityState, CitizenIncident, Tile } from '../domain/types';

export const MAX_CITIZENS = 720;
export const MAX_RAGDOLLS = 8;
/** One tile is roughly ten metres; adult figures stay below .18 world units. */
export const CITIZEN_SCALE = 0.29;
export const CITIZEN_PICK_RADIUS = 0.18;
export const MAX_HAND_SPEED = 10;
export const IMPACT_THRESHOLD = DISMEMBERMENT_SPEED;
export const GET_UP_SECONDS = 1.9;

/** Distance-driven stance/swing cycle. During stance local foot travel exactly
 * cancels body travel, so planted feet stay fixed instead of skating. */
export function citizenWalkingGait(phase: number, scale = CITIZEN_SCALE) {
  const stride = 0.38 * scale;
  const foot = (offset: number) => {
    const t = (((phase / (Math.PI * 2) + offset) % 1) + 1) % 1;
    if (t < 0.5) return { forward: (0.25 - t) * stride, lift: 0, planted: true };
    const swing = (t - 0.5) * 2,
      smooth = swing * swing * (3 - 2 * swing);
    return {
      forward: (smooth * 0.5 - 0.25) * stride,
      lift: Math.sin(swing * Math.PI) * 0.045 * scale,
      planted: false,
    };
  };
  return { stride, left: foot(0), right: foot(0.5) };
}

export const CITIZEN_PHYSICS_STEP = 1 / 240;
export const SEVERE_VEHICLE_IMPACT_SPEED = VEHICLE_DISMEMBERMENT_SPEED;
const GROUND_GROUP = 1,
  PERSON_GROUP = 2,
  BUILDING_GROUP = 4;
const PARTS = ['torso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
type PartName = (typeof PARTS)[number];
type Incident = Omit<CitizenIncident, 'id' | 'month'>;
type Vec = { x: number; y: number; z: number };
type Hit = { point: Vec; normal: Vec; speed: number; cause?: 'vehicle' | 'collision' };
export interface CitizenVehicleSweep {
  previous: Vec;
  current: Vec;
  yaw: number;
  width: number;
  length: number;
  height?: number;
  previousYaw?: number;
  velocity: Vec;
  vehicleId: number;
  trafficOnly?: boolean;
}
export interface CitizenObservation {
  topic: CitizenDialogueTopic;
  position: Vec;
  id?: string | number;
}
type PaneSurface = { axis: 'x' | 'z'; direction: 1 | -1; outer: number; inner: number };
const physicalPaneSurfaces = new WeakMap<CANNON.Shape, PaneSurface>();
const authoredPaneSurfaces = new WeakMap<THREE.Box3, PaneSurface>();
const clamp = THREE.MathUtils.clamp;
const random = (n: number) => {
  const value = Math.sin(n * 127.1 + 31.7) * 43758.5453;
  return value - Math.floor(value);
};

export type CitizenSpeechKind =
  'idle' | 'held' | 'recovery' | 'witness' | 'nearMiss' | 'vehicle' | 'observation';
export interface CitizenSpeech {
  actorId: number;
  text: string;
  kind: CitizenSpeechKind;
  expiresAt: number;
}

/** Event-driven, bounded dialogue: reactions can interrupt idle chatter. */
export class CitizenDialogue {
  private active: (CitizenSpeech & { pair?: CitizenDialoguePair })[] = [];
  private last = new Map<string, number>();
  private priority(kind: CitizenSpeechKind): number {
    return kind === 'idle' ? 0 : kind === 'observation' ? 1 : 2;
  }
  getActive(now: number): CitizenSpeech[] {
    this.active = this.active.filter((speech) => speech.expiresAt > now);
    // Keep the selected line and its expiry: changing language must not select
    // another line, reset a reaction cooldown, or extend a bubble's lifetime.
    return this.active.map(({ pair, ...speech }) => ({
      ...speech,
      text: pair ? tr(pair.de, pair.en) : speech.text,
    }));
  }
  canSpeak(actorId: number, kind: CitizenSpeechKind, now: number): boolean {
    this.getActive(now);
    const key = `${actorId}:${kind}`,
      cooldown = kind === 'idle' ? 28 : kind === 'observation' ? 8 : 4;
    if (now - (this.last.get(key) ?? -Infinity) < cooldown) return false;
    const existing = this.active.findIndex((speech) => speech.actorId === actorId);
    if ((kind === 'idle' || kind === 'observation') && (existing >= 0 || this.active.length >= 3))
      return false;
    if (existing >= 0 && this.priority(kind) < this.priority(this.active[existing].kind))
      return false;
    if (
      existing < 0 &&
      this.active.length >= 3 &&
      !this.active.some((speech) => this.priority(speech.kind) <= this.priority(kind))
    )
      return false;
    return true;
  }
  speak(
    actorId: number,
    text: string | CitizenDialoguePair,
    kind: CitizenSpeechKind,
    now: number,
  ): boolean {
    if (!this.canSpeak(actorId, kind, now)) return false;
    const key = `${actorId}:${kind}`,
      existing = this.active.findIndex((speech) => speech.actorId === actorId);
    if (existing >= 0) this.active.splice(existing, 1);
    if (this.active.length >= 3) {
      const lowest = Math.min(...this.active.map((speech) => this.priority(speech.kind))),
        oldest = this.active.findIndex((speech) => this.priority(speech.kind) === lowest);
      this.active.splice(oldest, 1);
    }
    const ambient = kind === 'idle' || kind === 'observation';
    const pair =
      typeof text === 'string'
        ? undefined
        : { de: text.de.slice(0, 140), en: text.en.slice(0, 140) };
    this.last.set(key, now);
    this.active.push({
      actorId,
      text: typeof text === 'string' ? text.slice(0, 140) : pair!.de,
      kind,
      expiresAt: now + (ambient ? 7 : 3.5),
      ...(pair ? { pair } : {}),
    });
    return true;
  }
  forget(actorId: number): void {
    this.active = this.active.filter((speech) => speech.actorId !== actorId);
    for (const key of this.last.keys()) if (key.startsWith(`${actorId}:`)) this.last.delete(key);
  }
  clear(): void {
    this.active = [];
    this.last.clear();
  }
}

function citizenContextTopic(state: CityState, position: Vec): CitizenDialogueTopic {
  const hour = state.settings.timeOfDay ?? 14;
  if (hour < 6 || hour >= 20) return 'night';
  const x = Math.floor(position.x + state.size / 2),
    z = Math.floor(position.z + state.size / 2),
    tile = state.tiles[z * state.size + x];
  if (state.stats.pollution > 40 || (tile?.pollution ?? 0) > 40) return 'industry';
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx,
        zz = z + dz;
      if (
        xx >= 0 &&
        zz >= 0 &&
        xx < state.size &&
        zz < state.size &&
        state.tiles[zz * state.size + xx]?.kind === 'park'
      )
        return 'park';
    }
  if (state.settings.weather === 'rain') return 'rain';
  if (state.stats.happiness >= 75) return 'happy';
  if (state.stats.happiness < 40) return 'unhappy';
  if (state.stats.traffic > 45) return 'traffic';
  return 'everyday';
}

export function chooseCitizenComment(state: CityState, position: Vec, variant: number): string {
  return createCitizenSpeechSelector(state.seed + Math.floor(variant) * 31).pick(
    citizenContextTopic(state, position),
    variant,
  );
}

/** Segment-versus-expanded oriented car box; detects impacts between frames. */
export function sweepVehicleFootprint(
  position: Vec,
  event: CitizenVehicleSweep,
  radius = 0.025,
): { time: number; normal: Vec } | null {
  if (
    ![
      position.x,
      position.y,
      position.z,
      event.yaw,
      event.width,
      event.length,
      ...Object.values(event.previous),
      ...Object.values(event.current),
    ].every(Number.isFinite) ||
    event.width <= 0 ||
    event.length <= 0
  )
    return null;
  const c = Math.cos(event.yaw),
    s = Math.sin(event.yaw),
    height = event.height ?? 0.18;
  const transform = (point: Vec) => ({
    x: c * (position.x - point.x) - s * (position.z - point.z),
    y: position.y - point.y - height / 2,
    z: s * (position.x - point.x) + c * (position.z - point.z),
  });
  const from = transform(event.previous),
    to = transform(event.current),
    bounds = { x: event.width / 2 + radius, y: height / 2 + 0.024, z: event.length / 2 + radius };
  let enter = 0,
    exit = 1,
    axis: 'x' | 'y' | 'z' = 'x',
    sign = from.x >= 0 ? 1 : -1;
  for (const name of ['x', 'y', 'z'] as const) {
    const velocity = to[name] - from[name],
      extent = bounds[name];
    if (Math.abs(velocity) < 1e-10) {
      if (Math.abs(from[name]) > extent) return null;
      continue;
    }
    const near = (-extent - from[name]) / velocity,
      far = (extent - from[name]) / velocity,
      t0 = Math.min(near, far),
      t1 = Math.max(near, far);
    if (t0 > enter) {
      enter = t0;
      axis = name;
      sign = velocity > 0 ? -1 : 1;
    }
    exit = Math.min(exit, t1);
    if (enter > exit) return null;
  }
  if (exit < 0 || enter > 1) return null;
  const local = {
    x: axis === 'x' ? sign : 0,
    y: axis === 'y' ? sign : 0,
    z: axis === 'z' ? sign : 0,
  };
  return {
    time: Math.max(0, enter),
    normal: { x: c * local.x + s * local.z, y: local.y, z: -s * local.x + c * local.z },
  };
}

/** Physical proportions are adult, stylised to remain readable at city scale. */
const dimensions: Record<
  PartName,
  { size: [number, number, number]; offset: [number, number, number]; mass: number }
> = {
  torso: { size: [0.16, 0.23, 0.115], offset: [0, 0.32, 0], mass: 3 },
  head: { size: [0.105, 0.125, 0.105], offset: [0, 0.495, 0], mass: 0.7 },
  leftArm: { size: [0.05, 0.215, 0.055], offset: [-0.12, 0.32, 0], mass: 0.35 },
  rightArm: { size: [0.05, 0.215, 0.055], offset: [0.12, 0.32, 0], mass: 0.35 },
  leftLeg: { size: [0.063, 0.21, 0.075], offset: [-0.049, 0.105, 0], mass: 0.65 },
  rightLeg: { size: [0.063, 0.21, 0.075], offset: [0.049, 0.105, 0], mass: 0.65 },
};

export function createCitizenPhysicsWorld(): CANNON.World {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -CITIZEN_WORLD_GRAVITY, 0),
    allowSleep: true,
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  (world.solver as CANNON.GSSolver).iterations = 18;
  (world.solver as CANNON.GSSolver).tolerance = 0.00001;
  world.defaultContactMaterial.friction = 0.62;
  world.defaultContactMaterial.restitution = 0.08;
  world.defaultContactMaterial.contactEquationStiffness = 1e7;
  world.defaultContactMaterial.contactEquationRelaxation = 3;
  return world;
}

/** Six independent rigid bodies, connected by anatomically bounded cone joints. */
export class CitizenRagdoll {
  readonly bodies: Record<PartName, CANNON.Body>;
  readonly constraints: CANNON.ConeTwistConstraint[] = [];
  readonly scale: number;
  private grab: CANNON.Body | null = null;
  private grabJoint: CANNON.PointToPointConstraint | null = null;
  private handTarget = new CANNON.Vec3();
  private handDelta = new CANNON.Vec3();
  private heldGround: ((x: number, z: number) => number) | null = null;
  private reported = false;
  private released = false;
  private contacted = false;
  private disposed = false;
  private severeVehicleImpactSpeed = 0;
  age = 0;
  private stepHand = (): void => {
    if (!this.grab) return;
    this.constrainHeldTarget(this.handTarget);
    this.handTarget.vsub(this.grab.position, this.handDelta);
    const distance = this.handDelta.length(),
      maximum = MAX_HAND_SPEED * Math.min(this.world.dt || 1 / 120, 0.05);
    if (distance > maximum) this.handDelta.scale(maximum / distance, this.handDelta);
    this.grab.position.vadd(this.handDelta, this.grab.position);
    // The limited hand's intermediate position can cross an uphill slope even
    // when its final target is safe. Keep the anchor above that support too.
    this.constrainHeldTarget(this.grab.position);
    this.grab.aabbNeedsUpdate = true;
  };
  private supportHeldBody = (): void => {
    if (this.grab && this.heldGround) this.clearGroundPenetration(this.heldGround);
  };

  constructor(
    private world: CANNON.World,
    origin: Vec,
    heading = 0,
    scale = CITIZEN_SCALE,
    private onImpact?: (hit: Hit) => void,
  ) {
    this.scale = scale;
    this.bodies = {} as Record<PartName, CANNON.Body>;
    for (const name of PARTS) {
      const spec = dimensions[name],
        [sx, sy, sz] = spec.size,
        [ox, oy, oz] = spec.offset;
      const body = new CANNON.Body({
        mass: spec.mass,
        shape:
          name === 'head'
            ? new CANNON.Sphere(0.06 * scale)
            : new CANNON.Box(new CANNON.Vec3((sx * scale) / 2, (sy * scale) / 2, (sz * scale) / 2)),
        position: new CANNON.Vec3(
          origin.x + (ox * Math.cos(heading) + oz * Math.sin(heading)) * scale,
          origin.y + oy * scale,
          origin.z + (-ox * Math.sin(heading) + oz * Math.cos(heading)) * scale,
        ),
        linearDamping: CITIZEN_AIR_DAMPING,
        angularDamping: 0.38,
        collisionFilterGroup: PERSON_GROUP,
        collisionFilterMask: GROUND_GROUP | BUILDING_GROUP,
        allowSleep: true,
        sleepSpeedLimit: 0.08,
        sleepTimeLimit: 0.6,
      });
      body.quaternion.setFromEuler(0, heading, 0);
      body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
        if (!this.released || this.reported || this.disposed) return;
        this.contacted = true;
        const contact = event.contact,
          speed = Math.abs(contact.getImpactVelocityAlongNormal());
        const vehicleImpact = this.severeVehicleImpactSpeed >= SEVERE_VEHICLE_IMPACT_SPEED;
        if (speed < IMPACT_THRESHOLD && !vehicleImpact) return;
        this.reported = true;
        const personFirst = contact.bi === body,
          surface = personFirst ? contact.bj : contact.bi;
        const contactPoint = personFirst ? contact.rj : contact.ri;
        const sign = personFirst ? -1 : 1;
        const hit: Hit = {
          point: {
            x: surface.position.x + contactPoint.x,
            y: surface.position.y + contactPoint.y,
            z: surface.position.z + contactPoint.z,
          },
          normal: { x: contact.ni.x * sign, y: contact.ni.y * sign, z: contact.ni.z * sign },
          speed: vehicleImpact ? this.severeVehicleImpactSpeed : speed,
          cause: vehicleImpact ? 'vehicle' : 'collision',
        };
        // Cannon supplies the colliding shapes at runtime (its declaration
        // omits these fields). Fast overlap can select a thin pane's inward
        // separation face; use the authored face on the incoming side for the
        // visible impact, rather than stamping the invisible physics backing.
        const shaped = contact as CANNON.ContactEquation & { si?: CANNON.Shape; sj?: CANNON.Shape };
        const otherShape = personFirst ? shaped.sj : shaped.si,
          pane = otherShape ? physicalPaneSurfaces.get(otherShape) : undefined;
        if (
          pane &&
          Math.abs(hit.normal[pane.axis]) > 0.9 &&
          Math.abs(body.velocity[pane.axis]) > 0.01
        ) {
          const outside = body.velocity[pane.axis] * pane.direction < 0;
          hit.point[pane.axis] = surface.position[pane.axis] + (outside ? pane.outer : pane.inner);
          hit.normal = { x: 0, y: 0, z: 0 };
          hit.normal[pane.axis] = outside ? pane.direction : -pane.direction;
        }
        this.onImpact?.(hit);
      });
      this.bodies[name] = body;
      world.addBody(body);
    }
    const connect = (
      part: PartName,
      pivot: [number, number, number],
      otherPivot: [number, number, number],
      angle: number,
      twist: number,
    ) => {
      const joint = new CANNON.ConeTwistConstraint(this.bodies.torso, this.bodies[part], {
        pivotA: new CANNON.Vec3(...(pivot.map((v) => v * scale) as [number, number, number])),
        pivotB: new CANNON.Vec3(...(otherPivot.map((v) => v * scale) as [number, number, number])),
        axisA: new CANNON.Vec3(0, 1, 0),
        axisB: new CANNON.Vec3(0, 1, 0),
        angle,
        twistAngle: twist,
        maxForce: 900,
        collideConnected: false,
      });
      this.constraints.push(joint);
      world.addConstraint(joint);
    };
    connect('head', [0, 0.12, 0], [0, -0.055, 0], 0.65, 0.5);
    connect('leftArm', [-0.12, 0.085, 0], [0, 0.085, 0], 1.65, 1.1);
    connect('rightArm', [0.12, 0.085, 0], [0, 0.085, 0], 1.65, 1.1);
    connect('leftLeg', [-0.049, -0.11, 0], [0, 0.105, 0], 1.15, 0.5);
    connect('rightLeg', [0.049, -0.11, 0], [0, 0.105, 0], 1.15, 0.5);
  }

  hold(target: Vec, sampleHeight?: (x: number, z: number) => number): void {
    if (this.grab || this.disposed) return;
    this.released = false;
    this.heldGround = sampleHeight ?? null;
    for (const body of Object.values(this.bodies)) {
      body.collisionFilterMask = BUILDING_GROUP;
      body.wakeUp();
    }
    this.grab = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      collisionFilterGroup: 0,
      collisionFilterMask: 0,
      position: new CANNON.Vec3(target.x, target.y, target.z),
    });
    this.handTarget.set(target.x, target.y, target.z);
    this.constrainHeldTarget(this.handTarget);
    this.grab.position.copy(this.handTarget);
    this.world.addEventListener('preStep', this.stepHand);
    this.world.addEventListener('postStep', this.supportHeldBody);
    this.world.addBody(this.grab);
    this.grabJoint = new CANNON.PointToPointConstraint(
      this.bodies.torso,
      new CANNON.Vec3(0, 0, 0),
      this.grab,
      new CANNON.Vec3(),
      1100,
    );
    this.world.addConstraint(this.grabJoint);
    this.supportHeldBody();
  }

  move(target: Vec): void {
    if (!this.grab) return;
    // The hand is speed-limited per physics step, so a long, fast pointer jump
    // cannot stretch the joints or inject hundreds of units/second of energy.
    this.handTarget.set(target.x, target.y, target.z);
    this.constrainHeldTarget(this.handTarget);
    this.supportHeldBody();
    for (const body of Object.values(this.bodies)) body.wakeUp();
  }

  release(velocity: Vec): void {
    this.detach();
    this.released = true;
    this.age = 0;
    const length = Math.hypot(velocity.x, velocity.y, velocity.z),
      factor = length > MAX_HAND_SPEED ? MAX_HAND_SPEED / length : 1;
    for (const body of Object.values(this.bodies)) {
      body.collisionFilterMask = GROUND_GROUP | BUILDING_GROUP;
      body.velocity.set(velocity.x * factor, velocity.y * factor, velocity.z * factor);
      body.wakeUp();
    }
  }
  markSevereVehicleImpact(speed: number): void {
    if (Number.isFinite(speed))
      this.severeVehicleImpactSpeed = Math.max(this.severeVehicleImpactSpeed, speed);
  }
  /** Translation required to support every part, including the uphill edge of
   * its footprint. May be negative when a held pose has room to move downward. */
  private requiredGroundLift(
    sampleHeight: (x: number, z: number) => number,
    dx = 0,
    dz = 0,
  ): number {
    let lift = -Infinity;
    for (const name of PARTS) {
      const body = this.bodies[name];
      body.updateAABB();
      const { lowerBound: low, upperBound: high } = body.aabb;
      // Corners plus centre/edge midpoints handle slopes, pavement lips and
      // support beneath rotated parts, rather than sampling only torso height.
      for (let ix = 0; ix < 3; ix++)
        for (let iz = 0; iz < 3; iz++) {
          const height = sampleHeight(
            low.x + ((high.x - low.x) * ix) / 2 + dx,
            low.z + ((high.z - low.z) * iz) / 2 + dz,
          );
          if (Number.isFinite(height)) lift = Math.max(lift, height + 0.002 - low.y);
        }
    }
    return lift;
  }

  private constrainHeldTarget(target: Vec): void {
    if (!this.heldGround) return;
    target.y = Math.max(
      target.y,
      this.heldGround(target.x, target.z) + 0.32 * this.scale + 0.002,
      this.position.y +
        this.requiredGroundLift(
          this.heldGround,
          target.x - this.position.x,
          target.z - this.position.z,
        ),
    );
  }

  /** Support correction runs after every held physics substep, and before
   * release. Translate the entire pose and anchor together, without a spring
   * pulling it back below terrain or turning the correction into throw energy. */
  clearGroundPenetration(sampleHeight: (x: number, z: number) => number): void {
    const lift = this.requiredGroundLift(sampleHeight);
    if (lift <= 0) return;
    for (const body of Object.values(this.bodies)) {
      body.position.y += lift;
      if (this.grab) body.velocity.y = Math.max(0, body.velocity.y);
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      body.aabbNeedsUpdate = true;
    }
    if (this.grab) {
      this.grab.position.y += lift;
      this.grab.previousPosition.copy(this.grab.position);
      this.grab.interpolatedPosition.copy(this.grab.position);
      this.grab.aabbNeedsUpdate = true;
      this.constrainHeldTarget(this.handTarget);
    }
  }

  private detach(): void {
    this.world.removeEventListener('preStep', this.stepHand);
    this.world.removeEventListener('postStep', this.supportHeldBody);
    if (this.grabJoint) this.world.removeConstraint(this.grabJoint);
    if (this.grab) this.world.removeBody(this.grab);
    this.grabJoint = null;
    this.grab = null;
    this.heldGround = null;
  }

  get position(): CANNON.Vec3 {
    return this.bodies.torso.position;
  }
  get held(): boolean {
    return !!this.grab;
  }
  get impacted(): boolean {
    return this.reported;
  }
  get resting(): boolean {
    return (
      this.contacted &&
      Object.values(this.bodies).every(
        (body) => body.velocity.length() < 0.24 && body.angularVelocity.length() < 1,
      )
    );
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    for (const joint of this.constraints) this.world.removeConstraint(joint);
    for (const body of Object.values(this.bodies)) this.world.removeBody(body);
  }
}

export function isGentleRelease(
  torso: Vec,
  groundHeight: number,
  velocity: Vec,
  scale = CITIZEN_SCALE,
): boolean {
  return (
    torso.y - groundHeight <= 0.32 * scale + 0.12 &&
    Math.hypot(velocity.x, velocity.y, velocity.z) < 1.2
  );
}

export function isCitizenIncidentWitnessed(
  position: Vec,
  otherCitizens: readonly Vec[],
  police: readonly Vec[],
): boolean {
  return (
    otherCitizens.some(
      (p) => Math.hypot(p.x - position.x, p.z - position.z) < 6 && Math.abs(p.y - position.y) < 6,
    ) || police.some((p) => Math.hypot(p.x - position.x, p.z - position.z) < 7)
  );
}

function roadLinks(
  state: CityState,
  tile: Tile,
): { north: boolean; south: boolean; east: boolean; west: boolean } {
  const connects = (dx: number, dz: number) => {
    const x = tile.x + dx,
      z = tile.z + dz;
    return (
      x >= 0 &&
      z >= 0 &&
      x < state.size &&
      z < state.size &&
      ['road', 'airport', 'seaport'].includes(state.tiles[z * state.size + x].kind)
    );
  };
  const north = connects(0, -1),
    south = connects(0, 1),
    east = connects(1, 0),
    west = connects(-1, 0),
    isolated = !north && !south && !east && !west;
  return { north: north || isolated, south: south || isolated, east, west };
}

/** Match the visible sidewalk/asphalt/path height, including small curbs. */
export function citizenSurfaceHeight(state: CityState, x: number, z: number): number {
  const gx = Math.floor(x + state.size / 2),
    gz = Math.floor(z + state.size / 2),
    base = Math.max(-0.08, sampleGroundHeight(state, x, z));
  if (gx < 0 || gz < 0 || gx >= state.size || gz >= state.size) return base;
  const tile = state.tiles[gz * state.size + gx],
    dx = x - (gx - state.size / 2 + 0.5),
    dz = z - (gz - state.size / 2 + 0.5);
  if (tile.kind === 'road') {
    const links = roadLinks(state, tile),
      asphalt =
        (Math.abs(dx) <= 0.335 && Math.abs(dz) <= 0.335) ||
        (Math.abs(dx) <= 0.335 && (dz < 0 ? links.north : links.south)) ||
        (Math.abs(dz) <= 0.335 && (dx < 0 ? links.west : links.east));
    return base + (asphalt ? 0.0455 : 0.028);
  }
  if (tile.kind === 'park')
    return base + (Math.abs(dx) <= 0.08 || Math.abs(dz) <= 0.08 ? 0.0415 : 0.028);
  return base;
}

export function createGroundCollider(state: CityState, x: number, z: number): CANNON.Body {
  const wx = x - state.size / 2 + 0.5,
    wz = z - state.size / 2 + 0.5;
  const tile = state.tiles[z * state.size + x],
    paved = tile?.kind === 'road' || tile?.kind === 'park',
    top = Math.max(-0.08, sampleGroundHeight(state, wx, wz)) + (paved ? 0.028 : 0);
  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 8, 0.5)),
    position: new CANNON.Vec3(wx, top - 8, wz),
    collisionFilterGroup: GROUND_GROUP,
    collisionFilterMask: PERSON_GROUP,
  });
  const slab = (cx: number, cz: number, width: number, depth: number, height: number) =>
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)),
      new CANNON.Vec3(cx, 8 + height / 2, cz),
    );
  if (tile?.kind === 'road') {
    const links = roadLinks(state, tile);
    slab(0, 0, 0.67, 0.67, 0.0175);
    if (links.north) slab(0, -0.33, 0.67, 0.34, 0.0175);
    if (links.south) slab(0, 0.33, 0.67, 0.34, 0.0175);
    if (links.east) slab(0.33, 0, 0.34, 0.67, 0.0175);
    if (links.west) slab(-0.33, 0, 0.34, 0.67, 0.0175);
  } else if (tile?.kind === 'park') {
    slab(0, 0, 0.16, 0.92, 0.0135);
    slab(0, 0, 0.92, 0.16, 0.0135);
  }
  return body;
}

const structureCache = new Map<string, THREE.Box3[]>();
function buildingBoxes(state: CityState, tile: Tile): THREE.Box3[] {
  if (
    ['empty', 'tree', 'water', 'road', 'rail', 'park', 'rubble'].includes(tile.kind) ||
    (['residential', 'commercial', 'industrial'].includes(tile.kind) && tile.level === 0)
  )
    return [];
  if (tile.anchor >= 0 && tile.anchor !== tile.z * state.size + tile.x) return [];
  const key = `${tile.kind}:${tile.level}:${tile.variation}:${tile.rotation}:${tile.lotWidth ?? 1}:${tile.lotDepth ?? 1}:${tile.ruralCommercial ?? false}:${facilityAccessSignature(state, tile)}`;
  const cached = structureCache.get(key);
  if (cached) return cached;
  const model = createTileModel(tile, state),
    boxes: THREE.Box3[] = [],
    size = new THREE.Vector3();
  model.updateMatrixWorld(true);
  // Use actual structural meshes: stadium fields, runways and courtyards stay
  // open. Marked facade glass is solid; lamps and small decorations are ignored.
  model.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      !['BoxGeometry', 'CylinderGeometry', 'BufferGeometry'].includes(object.geometry.type)
    )
      return;
    object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    const bounds = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
    bounds.getSize(size);
    if (object.userData.glazingPane === true && size.y > 0.02 && Math.max(size.x, size.z) > 0.03) {
      const axis = size.x <= size.z ? 'x' : 'z';
      if (size[axis] < 0.055) {
        let frame: THREE.Object3D | null = object.parent;
        while (frame && frame !== model && !frame.userData.glazedStructure) frame = frame.parent;
        const reference = new THREE.Vector3().setFromMatrixPosition((frame ?? model).matrixWorld),
          centre = bounds.getCenter(new THREE.Vector3()),
          extra = Math.max(0, 0.015 - size[axis]),
          direction = centre[axis] >= reference[axis] ? 1 : -1;
        authoredPaneSurfaces.set(bounds, {
          axis,
          direction,
          outer: direction > 0 ? bounds.max[axis] : bounds.min[axis],
          inner: direction > 0 ? bounds.min[axis] : bounds.max[axis],
        });
        // Add physical thickness towards the room, preserving the authored
        // exterior plane so impacts and saved stains land on the glass surface.
        if (direction > 0) bounds.min[axis] -= extra;
        else bounds.max[axis] += extra;
      }
      boxes.push(bounds);
      return;
    }
    const horizontalSlab = size.y >= 0.018 && size.x >= 0.25 && size.z >= 0.25;
    if (
      (size.y < 0.09 && !horizontalSlab) ||
      size.x < 0.055 ||
      size.z < 0.055 ||
      size.x * size.y * size.z < 0.0018
    )
      return;
    boxes.push(bounds);
  });
  if (structureCache.size >= 128) structureCache.delete(structureCache.keys().next().value!);
  structureCache.set(key, boxes);
  return boxes;
}

/** A small compound of structural bounds, rather than a solid facility-wide box. */
export function createBuildingCollider(state: CityState, tile: Tile): CANNON.Body | null {
  const boxes = buildingBoxes(state, tile);
  if (!boxes.length) return null;
  const body = new CANNON.Body({
    mass: 0,
    position: new CANNON.Vec3(
      tile.x - state.size / 2 + 0.5,
      tile.elevation,
      tile.z - state.size / 2 + 0.5,
    ),
    collisionFilterGroup: BUILDING_GROUP,
    collisionFilterMask: PERSON_GROUP,
  });
  const center = new THREE.Vector3(),
    size = new THREE.Vector3();
  for (const box of boxes) {
    box.getCenter(center);
    box.getSize(size);
    const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
    body.addShape(shape, new CANNON.Vec3(center.x, center.y, center.z));
    const pane = authoredPaneSurfaces.get(box);
    if (pane) physicalPaneSurfaces.set(shape, pane);
  }
  return body;
}

interface PartPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}
interface Recovery {
  elapsed: number;
  from: Record<PartName, PartPose>;
}
interface Citizen {
  id: number;
  position: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  previous: number;
  node: number;
  progress: number;
  heading: number;
  scale: number;
  pace: number;
  phase: number;
  gaitBlend: number;
  variant: number;
  ragdoll: CitizenRagdoll | null;
  recovery: Recovery | null;
  crossing: boolean;
  waitUntil: number;
  dead: boolean;
  detailed?: boolean;
}
interface Held {
  citizen: Citizen;
  plane: THREE.Plane;
  offset: THREE.Vector3;
  target: THREE.Vector3;
  last: THREE.Vector3;
  velocity: THREE.Vector3;
  lastTime: number;
  lastMotionTime: number;
  gesture: ThrowGesture;
}
interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  color: number;
}

export interface CitizenSystem {
  group: THREE.Group;
  update: (state: CityState, reset?: boolean) => void;
  animate: (dt: number, walking: boolean, hour?: number) => void;
  getLife: () => CitizenLifeSnapshot;
  triggerEvent: (kind: CitizenEventKind, near: { x: number; z: number }) => CitizenEventResult;
  stopEvent: () => void;
  pointerDown: (ray: THREE.Ray, cameraDirection: THREE.Vector3, time: number) => boolean;
  pointerMove: (ray: THREE.Ray, time: number) => boolean;
  pointerUp: (time: number) => boolean;
  rebaseHeldCamera: (ray: THREE.Ray, cameraDirection: THREE.Vector3, time: number) => void;
  cancel: () => void;
  clearHover: () => void;
  setEnabled: (enabled: boolean) => void;
  setUiVisible: (visible: boolean) => void;
  refreshLocale: () => void;
  sweepVehicleImpact: (event: CitizenVehicleSweep) => void;
  notifyObservation: (event: CitizenObservation) => void;
  readonly holding: boolean;
  readonly cursor: 'grab' | 'grabbing' | 'default';
  getDebug: () => {
    count: number;
    rendered: number;
    detailed: number;
    distant: number;
    debris: number;
    ragdolls: number;
    recovering: number;
    held: number | null;
    hovered: number | null;
    speech: CitizenSpeech[];
    positions: {
      id: number;
      x: number;
      y: number;
      z: number;
      crossing: boolean;
      state: 'walking' | 'held' | 'ragdoll' | 'recovering';
    }[];
  };
  dispose: () => void;
}

export interface CitizenUiOptions {
  container: HTMLElement;
  getCamera: () => THREE.Camera;
  /** Viewport height in screen pixels; defaults to container.clientHeight or 720. */
  getViewportHeight?: () => number;
}

/** 31 detail batches and three distant silhouette batches; only active actors enter physics. */
export function createCitizens(
  initialState: CityState,
  onIncident?: (incident: Incident) => void,
  ui?: CitizenUiOptions,
): CitizenSystem {
  let state = initialState,
    enabled = false,
    elapsed = 0,
    spawnClock = 0,
    sequence = 0,
    held: Held | null = null,
    hovered: Citizen | null = null,
    uiVisible = true,
    nextComment = 16,
    lastObservation = -Infinity;
  const dialogue = new CitizenDialogue();
  const life = createCitizenLife();
  let lifeClock = 0;
  const speechSelector = createCitizenSpeechSelector(initialState.seed);
  let spawnWeights: number[] = [],
    spawnWeightTotal = 0;
  let renderCamera: THREE.Camera | null = null,
    viewportHeight = 720,
    renderedCitizens = 0,
    detailedCitizens = 0,
    distantCitizens = 0;
  const projectedCitizen = new THREE.Vector3();
  let nodes: number[] = [],
    police: THREE.Vector3[] = [],
    graphSignature = '',
    routeSignature = '',
    decalSignature = '';
  let pedestrianGraph: PedestrianGraph = createPedestrianGraph(initialState, []);
  const walkingCollisions = createDrivingCollisionWorld(initialState);
  const pedestrianBody = { halfWidth: 0.025, halfLength: 0.025, height: 0.18 };
  let previousKinds = initialState.tiles.map((tile) => tile.kind),
    previousWeather = initialState.settings.weather;
  const actorIndex = new Map<string, Citizen[]>(),
    vehicleContacts = new Map<number, number>(),
    observationCooldown = new Map<string, number>(),
    observationAttempts = new Map<string, number>();
  const vehicleAwareness = new Map<number, { event: CitizenVehicleSweep; time: number }>();
  const nodeSet = new Set<number>(),
    citizens: Citizen[] = [],
    pending: { citizen: Citizen; hit: Hit }[] = [],
    particles: Particle[] = [];
  const group = new THREE.Group();
  group.name = 'city-citizens';
  let eventVenue: THREE.Group | null = null,
    eventVenueSignature = '';
  function clearEventVenue(): void {
    if (eventVenue) disposeCitizenEventVenue(eventVenue);
    eventVenue = null;
    eventVenueSignature = '';
  }
  function venueSiteSignature(site: { x: number; z: number }): string {
    const x = Math.floor(site.x + state.size / 2),
      z = Math.floor(site.z + state.size / 2);
    const signature = [String(state.seed), String(state.size)];
    // Furniture and overhanging obstacles are selected from this local area.
    // Check it on city updates, not in the frame loop or on population changes.
    for (let zz = Math.max(0, z - 2); zz <= Math.min(state.size - 1, z + 2); zz++)
      for (let xx = Math.max(0, x - 2); xx <= Math.min(state.size - 1, x + 2); xx++) {
        const tile = state.tiles[zz * state.size + xx];
        signature.push(
          `${tile.kind}:${tile.elevation}:${tile.variation}:${tile.level}:${tile.anchor}:${tile.fire}`,
        );
      }
    return signature.join('|');
  }
  function syncEventVenue(checkSite = false): void {
    const event = life.getSnapshot().event;
    if (!event) clearEventVenue();
    else if (eventVenue && checkSite && venueSiteSignature(event) !== eventVenueSignature) {
      life.stopEvent();
      clearEventVenue();
    }
  }
  const world = createCitizenPhysicsWorld();
  const impactDebris = new ImpactDebris(world, group);
  const statics = new Map<string, { body: CANNON.Body; signature: string }>();
  const cube = new THREE.BoxGeometry(1, 1, 1),
    headGeometry = new THREE.SphereGeometry(0.5, 18, 12);
  // A narrower jaw and flatter face break the former spherical toy silhouette.
  const headVertices = headGeometry.getAttribute('position');
  for (let i = 0; i < headVertices.count; i++) {
    const y = headVertices.getY(i),
      jaw = 1 - Math.max(0, -y) * 0.42;
    headVertices.setXYZ(
      i,
      headVertices.getX(i) * jaw,
      y,
      headVertices.getZ(i) > 0
        ? headVertices.getZ(i) * (0.9 - 0.09 * Math.exp(-(((y - 0.12) / 0.12) ** 2)))
        : headVertices.getZ(i),
    );
  }
  headGeometry.computeVertexNormals();
  const profile = (points: number[][], segments = 12) =>
    new THREE.LatheGeometry(
      points.map(([x, y]) => new THREE.Vector2(x, y)),
      segments,
    );
  const hatGeometry = profile([
    [0, -0.5],
    [0.5, -0.5],
    [0.5, -0.28],
    [0.37, -0.2],
    [0.34, 0.4],
    [0.25, 0.5],
    [0, 0.5],
  ]);
  // Shoulder, chest, waist and hem rings; elliptical scaling supplies torso depth.
  const torsoGeometry = profile(
    [
      [0, -0.5],
      [0.43, -0.5],
      [0.44, -0.38],
      [0.37, -0.08],
      [0.45, 0.28],
      [0.52, 0.37],
      [0.51, 0.42],
      [0.39, 0.47],
      [0.23, 0.5],
      [0, 0.5],
    ],
    16,
  );
  const torsoVertices = torsoGeometry.getAttribute('position');
  for (let i = 0; i < torsoVertices.count; i++) {
    // Squared cloth cross-section: a broad chest and flatter front, with soft
    // corners instead of a rotationally symmetric vase-shaped jacket.
    const x = torsoVertices.getX(i),
      z = torsoVertices.getZ(i);
    const radius = Math.hypot(x, z);
    if (radius > 0) {
      torsoVertices.setX(i, Math.sign(x) * Math.pow(Math.abs(x) / radius, 0.72) * radius);
      torsoVertices.setZ(i, Math.sign(z) * Math.pow(Math.abs(z) / radius, 0.72) * radius);
    }
    torsoVertices.setZ(
      i,
      torsoVertices.getZ(i) *
        (1 - Math.min(1, Math.max(0, (torsoVertices.getY(i) - 0.25) / 0.1)) * 0.32),
    );
  }
  torsoGeometry.computeVertexNormals();
  // Visible taper at wrist/ankle and articulation bulge at elbow/knee.
  const limbGeometry = profile(
    [
      [0, -0.5],
      [0.3, -0.5],
      [0.36, -0.37],
      [0.39, -0.05],
      [0.43, 0.06],
      [0.46, 0.32],
      [0.42, 0.44],
      [0.25, 0.5],
      [0, 0.5],
    ],
    10,
  );
  // A rounded sleeve head extends into the shoulder volume. Its hidden cap is
  // wider than a wrist/ankle cap, eliminating the separate capped-tube seam.
  const sleeveGeometry = profile(
    [
      [0, -0.5],
      [0.38, -0.5],
      [0.42, -0.3],
      [0.46, 0.12],
      [0.54, 0.35],
      [0.58, 0.47],
      [0.4, 0.57],
      [0, 0.61],
    ],
    10,
  );
  const shoeGeometry = createCitizenShoeGeometry(),
    backpackGeometry = new RoundedBoxGeometry(1, 1, 1, 1, 0.17);
  const handParts: THREE.BufferGeometry[] = [
    new THREE.SphereGeometry(0.5, 10, 6).scale(0.85, 0.65, 0.8).translate(0, 0.12, 0),
  ];
  for (let finger = 0; finger < 4; finger++)
    handParts.push(
      new THREE.CapsuleGeometry(0.07, 0.27 - (finger === 3 ? 0.06 : 0), 2, 5).translate(
        -0.27 + finger * 0.18,
        -0.23,
        0,
      ),
    );
  handParts.push(
    new THREE.CapsuleGeometry(0.075, 0.22, 2, 5).rotateZ(-0.8).translate(0.34, 0.025, 0),
  );
  const handGeometry = mergeGeometries(handParts, false)!;
  for (const part of handParts) part.dispose();
  handGeometry.computeBoundingBox();
  const handBounds = handGeometry.boundingBox!,
    handCentre = handBounds.getCenter(new THREE.Vector3()),
    handSize = handBounds.getSize(new THREE.Vector3());
  handGeometry.translate(-handCentre.x, -handCentre.y, -handCentre.z);
  handGeometry.scale(1 / handSize.x, 1 / handSize.y, 1 / handSize.z);
  const rightHandGeometry = handGeometry.clone().rotateY(Math.PI),
    noseGeometry = new THREE.SphereGeometry(0.5, 8, 6),
    earGeometry = new THREE.SphereGeometry(0.5, 10, 8),
    cuffGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const hairGeometry = new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.74);
  // Retain the exact previous envelope while replacing boxy hair with a scalp
  // volume. The same capped shape also reads as longer hair behind the head.
  hairGeometry.computeBoundingBox();
  const hairBounds = hairGeometry.boundingBox!,
    hairCentre = hairBounds.getCenter(new THREE.Vector3()),
    hairSize = hairBounds.getSize(new THREE.Vector3());
  hairGeometry.translate(-hairCentre.x, -hairCentre.y, -hairCentre.z);
  hairGeometry.scale(1 / hairSize.x, 1 / hairSize.y, 1 / hairSize.z);
  const hairVertices = hairGeometry.getAttribute('position');
  for (let i = 0; i < hairVertices.count; i++) {
    const x = hairVertices.getX(i),
      y = hairVertices.getY(i),
      z = hairVertices.getZ(i);
    // Swept side part and a higher forehead; retain longer coverage at the nape.
    hairVertices.setXYZ(i, x + Math.max(0, y) * 0.12, y + Math.max(0, z) * (0.18 + x * 0.16), z);
  }
  hairGeometry.computeVertexNormals();
  const merged = (parts: THREE.BufferGeometry[]) => {
    const normalized = parts.map((part) => (part.index ? part.toNonIndexed() : part)),
      geometry = mergeGeometries(normalized, false)!;
    for (const part of new Set([...parts, ...normalized])) part.dispose();
    return geometry;
  };
  const eyePart = (geometry: THREE.BufferGeometry, tint: number) => {
    const rgb = new THREE.Color(tint),
      positions = geometry.getAttribute('position');
    const colours = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) rgb.toArray(colours, i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return geometry;
  };
  const eyeGeometry = merged([
    eyePart(new THREE.SphereGeometry(0.5, 8, 6).scale(1, 0.72, 0.5), 0xf1e5d9),
    eyePart(
      new THREE.SphereGeometry(0.5, 8, 4).scale(0.44, 0.55, 0.24).translate(0, 0, 0.23),
      0x273639,
    ),
  ]);
  const browGeometry = merged([
    new THREE.BoxGeometry(0.026, 0.006, 0.008).rotateZ(-0.08).translate(-0.022, 0.023, 0.046),
    new THREE.BoxGeometry(0.026, 0.006, 0.008).rotateZ(0.08).translate(0.022, 0.023, 0.046),
  ]);
  // Sample the actual jacket's front surface, rather than floating a rectangular
  // plate over a curved chest. This seam and its small buttons follow its contour.
  const jacketMesh = new THREE.Mesh(torsoGeometry);
  jacketMesh.scale.set(0.16, 0.23, 0.115);
  jacketMesh.updateMatrixWorld();
  const seamRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  const jacketFront = (y: number) => {
    seamRay.ray.origin.set(0, y, 1);
    return (seamRay.intersectObject(jacketMesh)[0]?.point.z ?? 0.04) + 0.0005;
  };
  const seamPositions: number[] = [],
    seamIndices: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const y = -0.09 + i * 0.014,
      z = jacketFront(y);
    seamPositions.push(-0.0012, y, z, 0.0012, y, z);
    if (i < 12) {
      const a = i * 2;
      seamIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const shirtFrontGeometry = new THREE.BufferGeometry();
  shirtFrontGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seamPositions, 3));
  shirtFrontGeometry.setIndex(seamIndices);
  shirtFrontGeometry.computeVertexNormals();
  const garmentGeometry = merged(
    [0.06, 0.023, -0.014, -0.051].map((y) =>
      new THREE.SphereGeometry(0.0022, 6, 3).scale(1, 1, 0.25).translate(0, y, jacketFront(y)),
    ),
  );
  // The printed emblems follow the sweater surface on both sides, without
  // floating rectangular patches or a new texture per citizen.
  const emblem = (back: boolean) => {
    const indexed = createDoubleEagleGeometry();
    const source = indexed.toNonIndexed();
    indexed.dispose();
    const attribute = source.getAttribute('position');
    const points: number[] = [];
    const direction = back ? 1 : -1;
    const stampRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, direction));
    const stamp = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, depth = 0) => {
      if (depth < 4 && Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > 0.018) {
        const ab = a.clone().add(b).multiplyScalar(0.5),
          bc = b.clone().add(c).multiplyScalar(0.5),
          ca = c.clone().add(a).multiplyScalar(0.5);
        stamp(a, ab, ca, depth + 1);
        stamp(ab, b, bc, depth + 1);
        stamp(ca, bc, c, depth + 1);
        stamp(ab, bc, ca, depth + 1);
        return;
      }
      for (const p of back ? [c, b, a] : [a, b, c]) {
        stampRay.ray.origin.set(p.x, p.y, -direction);
        const z = stampRay.intersectObject(jacketMesh)[0]?.point.z ?? -direction * 0.04;
        points.push(p.x, p.y, z - direction * 0.001);
      }
    };
    for (let i = 0; i < attribute.count; i += 3) {
      const p = [0, 1, 2].map(
        (j) =>
          new THREE.Vector2(attribute.getX(i + j) * 0.086, attribute.getY(i + j) * 0.096 + 0.005),
      );
      stamp(p[0], p[1], p[2]);
    }
    source.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.computeVertexNormals();
    return geometry;
  };
  const eagleFrontGeometry = emblem(false),
    eagleBackGeometry = emblem(true);
  (jacketMesh.material as THREE.Material).dispose();
  const mouthGeometry = new THREE.SphereGeometry(0.5, 8, 4);
  const collarGeometry = merged([
    new THREE.BoxGeometry(0.03, 0.019, 0.002).rotateZ(-0.5).translate(-0.017, 0, 0),
    new THREE.BoxGeometry(0.03, 0.019, 0.002).rotateZ(0.5).translate(0.017, 0, 0),
  ]);
  const materials = createCitizenMaterials();
  // Three enables geometry vertex colours only on the eyes. Other leather
  // batches have no colour attribute and use its default white attribute.
  materials.leather.vertexColors = true;
  const slots = [
    'torso',
    'head',
    'leftArm',
    'rightArm',
    'leftLeg',
    'rightLeg',
    'leftForeArm',
    'rightForeArm',
    'leftLowerLeg',
    'rightLowerLeg',
    'hat',
    'hair',
    'nose',
    'leftEye',
    'rightEye',
    'backpack',
    'leftShoe',
    'rightShoe',
    'shirtFront',
    'collar',
    'leftHand',
    'rightHand',
    'leftEar',
    'rightEar',
    'leftCuff',
    'rightCuff',
    'neck',
    'brows',
    'mouth',
    'garmentDetails',
    'hairDetail',
    'eagleFront',
    'eagleBack',
  ] as const;
  const meshes = new Map<string, THREE.InstancedMesh>();
  for (const name of slots) {
    const geometry =
      name === 'eagleFront'
        ? eagleFrontGeometry
        : name === 'eagleBack'
          ? eagleBackGeometry
          : name === 'shirtFront'
            ? shirtFrontGeometry
            : name === 'leftArm' || name === 'rightArm'
              ? sleeveGeometry
              : name === 'collar'
                ? collarGeometry
                : name === 'brows'
                  ? browGeometry
                  : name === 'garmentDetails'
                    ? garmentGeometry
                    : name === 'mouth'
                      ? mouthGeometry
                      : name === 'neck'
                        ? cuffGeometry
                        : name === 'hairDetail'
                          ? earGeometry
                          : name === 'head'
                            ? headGeometry
                            : name === 'hat'
                              ? hatGeometry
                              : name === 'torso'
                                ? torsoGeometry
                                : name === 'hair'
                                  ? hairGeometry
                                  : name === 'backpack'
                                    ? backpackGeometry
                                    : name.endsWith('Eye')
                                      ? eyeGeometry
                                      : name === 'nose'
                                        ? noseGeometry
                                        : name.endsWith('Shoe')
                                          ? shoeGeometry
                                          : name === 'leftHand'
                                            ? handGeometry
                                            : name === 'rightHand'
                                              ? rightHandGeometry
                                              : name.endsWith('Ear')
                                                ? earGeometry
                                                : name.endsWith('Cuff')
                                                  ? cuffGeometry
                                                  : name.includes('Arm') || name.includes('Leg')
                                                    ? limbGeometry
                                                    : cube;
    const material =
      name === 'head' ||
      name === 'nose' ||
      name === 'neck' ||
      name.endsWith('Hand') ||
      name.endsWith('Ear') ||
      name === 'mouth'
        ? materials.skin
        : name.startsWith('hair') || name === 'brows'
          ? materials.hair
          : name.endsWith('Shoe') || name.endsWith('Eye') || name === 'backpack'
            ? materials.leather
            : materials.cloth;
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_CITIZENS);
    mesh.name = `citizen-${name}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    meshes.set(name, mesh);
    group.add(mesh);
  }
  const lodGeometries = createCitizenLodGeometries();
  const lodMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    vertexColors: true,
  });
  const lodMeshes = new Map<string, THREE.InstancedMesh>();
  for (const [name, geometry] of Object.entries(lodGeometries)) {
    const mesh = new THREE.InstancedMesh(geometry, lodMaterial, MAX_CITIZENS);
    mesh.name = `crowd-lod-${name}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.receiveShadow = true;
    // Tiny moving limb shadows are another source of overview shimmer.
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    lodMeshes.set(name, mesh);
    group.add(mesh);
  }
  const splatMaterial = new THREE.MeshStandardMaterial({
    color: 0x752b2a,
    roughness: 0.67,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -0.3,
    polygonOffsetUnits: -0.3,
  });
  const decals = new THREE.Group();
  decals.name = 'persistent-citizen-splatters';
  group.add(decals);
  const particleGeometry = new THREE.IcosahedronGeometry(0.5, 0),
    particleMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
  const particleMesh = new THREE.InstancedMesh(particleGeometry, particleMaterial, 256);
  particleMesh.count = 0;
  particleMesh.frustumCulled = false;
  particleMesh.userData.raytracingExclude = true;
  group.add(particleMesh);
  const dummy = new THREE.Object3D(),
    color = new THREE.Color(),
    local = new THREE.Vector3(),
    axisY = new THREE.Vector3(0, 1, 0),
    axisZ = new THREE.Vector3(0, 0, 1);
  const shirts = [0x9e6948, 0x3f7181, 0xb5a05b, 0x686282, 0x995e67, 0x647b5c, 0xd8cdb3, 0x42566e];
  const skins = [0xf0bd94, 0xc8845e, 0x8f5941, 0xe2a877, 0x633f32];
  const trousers = [0x354959, 0x6f6954, 0x6c5577, 0x454d4c];
  const hairs = [0x42342c, 0xcc995a, 0x817976, 0x633e2e];

  function say(citizen: Citizen, topic: CitizenDialogueTopic, kind: CitizenSpeechKind): boolean {
    if (citizen.dead || !dialogue.canSpeak(citizen.id, kind, elapsed)) return false;
    if ((kind === 'idle' || kind === 'observation') && !onScreen(citizen)) return false;
    return dialogue.speak(citizen.id, speechSelector.pickPair(topic, citizen.id), kind, elapsed);
  }
  function onScreen(citizen: Citizen): boolean {
    if (!ui) return true;
    const p = headPosition(citizen).project(ui.getCamera());
    return p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.97;
  }
  function ambientTopic(citizen: Citizen): CitizenDialogueTopic {
    const topics: CitizenDialogueTopic[] = [
      'everyday',
      'everyday',
      citizenContextTopic(state, citizen.position),
    ];
    const gx = Math.floor(citizen.position.x + state.size / 2),
      gz = Math.floor(citizen.position.z + state.size / 2);
    for (let z = Math.max(0, gz - 3); z <= Math.min(state.size - 1, gz + 3); z++)
      for (let x = Math.max(0, gx - 3); x <= Math.min(state.size - 1, gx + 3); x++) {
        const tile = state.tiles[z * state.size + x];
        let topic: CitizenDialogueTopic | undefined;
        if (tile.fire > 0) return 'fire';
        else if (tile.kind === 'tree') topic = 'trees';
        else if (tile.kind === 'park') topic = 'park';
        else if (tile.kind === 'water') topic = 'water';
        else if (tile.kind === 'industrial') topic = 'industry';
        else if (tile.kind === 'stadium') topic = 'stadium';
        else if (tile.kind === 'airport') topic = 'airport';
        else if (['police', 'fire', 'hospital', 'school', 'university'].includes(tile.kind))
          topic = 'services';
        if (topic && !topics.includes(topic)) topics.push(topic);
      }
    if (
      state.settings.weather === 'clear' &&
      state.settings.timeOfDay >= 7 &&
      state.settings.timeOfDay < 19
    )
      topics.push('sun');
    return topics[Math.floor(random(elapsed * 7 + citizen.id) * topics.length)];
  }
  function actorTorso(citizen: Citizen): THREE.Vector3 {
    if (citizen.ragdoll) {
      const p = citizen.ragdoll.position;
      return new THREE.Vector3(p.x, p.y, p.z);
    }
    if (citizen.recovery) return recoveryPose(citizen, 'torso').position;
    return citizen.position.clone().add(new THREE.Vector3(0, 0.32 * citizen.scale, 0));
  }
  function rebuildActorIndex(): void {
    actorIndex.clear();
    for (const citizen of citizens)
      if (!citizen.dead) {
        const p = actorTorso(citizen),
          key = `${Math.floor(p.x)}:${Math.floor(p.z)}`,
          bucket = actorIndex.get(key) ?? [];
        bucket.push(citizen);
        actorIndex.set(key, bucket);
      }
  }
  function notifyObservation(event: CitizenObservation): void {
    const urgent = ['carCrash', 'personHit', 'fire', 'nearMiss'].includes(event.topic);
    const kind: CitizenSpeechKind = urgent ? 'witness' : 'observation';
    if (elapsed - lastObservation < 1.8 && !urgent) return;
    const key =
      event.id !== undefined
        ? `${event.topic}:${event.id}`
        : `${event.topic}:${Math.round(event.position.x)}:${Math.round(event.position.z)}`;
    if (elapsed - (observationCooldown.get(key) ?? -Infinity) < (urgent ? 9 : 18)) return;
    if (elapsed - (observationAttempts.get(key) ?? -Infinity) < (urgent ? 0.5 : 1)) return;
    observationAttempts.set(key, elapsed);
    const point = new THREE.Vector3(event.position.x, event.position.y, event.position.z);
    const range = ['fastCar', 'drift', 'carCrash', 'personHit', 'nearMiss', 'traffic'].includes(
      event.topic,
    )
      ? 3.5
      : 6;
    const candidate = citizens
      .filter(
        (c) =>
          !c.dead &&
          !c.ragdoll &&
          !c.recovery &&
          c.position.distanceTo(point) < range &&
          dialogue.canSpeak(c.id, kind, elapsed) &&
          onScreen(c),
      )
      .sort((a, b) => a.position.distanceToSquared(point) - b.position.distanceToSquared(point))[0];
    if (candidate && say(candidate, event.topic, kind)) {
      observationCooldown.set(key, elapsed);
      lastObservation = elapsed;
    }
    if (observationCooldown.size > 256)
      for (const [id, time] of observationCooldown)
        if (elapsed - time > 30) observationCooldown.delete(id);
    if (observationAttempts.size > 256)
      for (const [id, time] of observationAttempts)
        if (elapsed - time > 10) observationAttempts.delete(id);
  }

  function crosswalkHasTraffic(citizen: Citizen): boolean {
    if (!citizen.crossing || citizen.progress > 0.045) return false;
    for (const { event, time } of vehicleAwareness.values()) {
      if (elapsed - time > 0.6 || Math.hypot(event.velocity.x, event.velocity.z) < 0.08) continue;
      if (Math.hypot(event.current.x - citizen.from.x, event.current.z - citizen.from.z) > 3.5)
        continue;
      const future = {
        ...event,
        previous: event.current,
        current: {
          x: event.current.x + event.velocity.x * 2.7,
          y: event.current.y,
          z: event.current.z + event.velocity.z * 2.7,
        },
      };
      for (const t of [0.2, 0.5, 0.8]) {
        const p = citizen.from.clone().lerp(citizen.to, t);
        p.y += 0.32 * citizen.scale;
        if (sweepVehicleFootprint(p, future, 0.04)) return true;
      }
    }
    return false;
  }

  function sweepVehicleImpact(event: CitizenVehicleSweep): void {
    const speed = Math.hypot(event.velocity.x, event.velocity.z);
    if (
      !Number.isFinite(speed) ||
      ![
        event.width,
        event.length,
        event.yaw,
        event.current.x,
        event.current.y,
        event.current.z,
        event.previous.x,
        event.previous.y,
        event.previous.z,
      ].every(Number.isFinite) ||
      event.width <= 0 ||
      event.length <= 0
    )
      return;
    vehicleAwareness.set(event.vehicleId, { event, time: elapsed });
    if (vehicleAwareness.size > 192)
      for (const [id, value] of vehicleAwareness)
        if (elapsed - value.time > 1) vehicleAwareness.delete(id);
    if (speed < 0.08) return;
    const padding = Math.hypot(event.width, event.length) / 2 + 0.8,
      candidates = new Set<Citizen>();
    for (
      let z = Math.floor(Math.min(event.previous.z, event.current.z) - padding);
      z <= Math.floor(Math.max(event.previous.z, event.current.z) + padding);
      z++
    )
      for (
        let x = Math.floor(Math.min(event.previous.x, event.current.x) - padding);
        x <= Math.floor(Math.max(event.previous.x, event.current.x) + padding);
        x++
      )
        for (const citizen of actorIndex.get(`${x}:${z}`) ?? []) candidates.add(citizen);
    for (const citizen of candidates) {
      if (citizen.dead || held?.citizen === citizen) continue;
      const torso = actorTorso(citizen),
        hit = sweepVehicleFootprint(torso, event, 0.025);
      if (!hit || event.trafficOnly) {
        if (speed >= 0.4 && sweepVehicleFootprint(torso, event, 0.15)) {
          if (event.trafficOnly && !hit)
            notifyObservation({ topic: 'traffic', position: event.current, id: event.vehicleId });
          else say(citizen, 'nearMiss', 'nearMiss');
          if (citizen.crossing && citizen.progress < 0.045)
            citizen.waitUntil = Math.max(citizen.waitUntil, elapsed + 0.45);
        }
        continue;
      }
      if (elapsed - (vehicleContacts.get(citizen.id) ?? -Infinity) < 0.85) continue;
      vehicleContacts.set(citizen.id, elapsed);
      if (speed < 0.12) {
        say(citizen, 'nearMiss', 'nearMiss');
        continue;
      }
      if (!citizen.ragdoll) {
        const active = citizens.filter((c) => c.ragdoll && !c.dead);
        if (active.length >= MAX_RAGDOLLS) {
          say(citizen, 'nearMiss', 'nearMiss');
          continue;
        }
        citizen.recovery = null;
        const origin = new THREE.Vector3(torso.x, ground(torso.x, torso.z) + 0.006, torso.z);
        citizen.ragdoll = new CitizenRagdoll(
          world,
          origin,
          citizen.heading,
          citizen.scale,
          (impact) => pending.push({ citizen, hit: impact }),
        );
      }
      const impulse = {
        x: event.velocity.x * 0.9,
        y: 0.22 + Math.min(1, speed * 0.34),
        z: event.velocity.z * 0.9,
      };
      citizen.ragdoll.release(impulse);
      if (speed >= SEVERE_VEHICLE_IMPACT_SPEED) citizen.ragdoll.markSevereVehicleImpact(speed);
      say(citizen, 'personHit', 'vehicle');
      witnessReaction(citizen, torso, 'personHit');
    }
    if (!event.trafficOnly && speed > 1.08)
      notifyObservation({ topic: 'fastCar', position: event.current, id: event.vehicleId });
    const lateral = event.velocity.x * Math.cos(event.yaw) - event.velocity.z * Math.sin(event.yaw);
    if (!event.trafficOnly && speed > 0.65 && Math.abs(lateral) > speed * 0.48)
      notifyObservation({ topic: 'drift', position: event.current, id: event.vehicleId });
  }

  // Pixel-sized UI remains readable in both orthographic and chase cameras.
  // The optional camera getter is first called from animate(), after scene setup.
  const overlay = ui && typeof document !== 'undefined' ? document.createElement('div') : null;
  let handBadge: HTMLDivElement | null = null;
  const bubbleNodes = new Map<
    number,
    {
      element: HTMLDivElement;
      label: HTMLSpanElement;
      tail: HTMLSpanElement;
      text: string;
      width: number;
      height: number;
      maxWidth: number;
    }
  >();
  if (overlay && ui) {
    overlay.className = 'citizen-feedback';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:6;';
    handBadge = document.createElement('div');
    handBadge.className = 'citizen-grab-marker';
    handBadge.style.cssText =
      'position:absolute;display:none;width:24px;height:24px;box-sizing:border-box;padding:4px;background:rgba(32,51,56,.88);border:1px solid rgba(255,255,255,.5);border-radius:6px;color:#fff8eb;box-shadow:0 2px 6px #15262b33;transform:translate(-50%,-100%);pointer-events:none;';
    handBadge.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M8 13V5a2 2 0 0 1 4 0v7-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v7c0 4-2 6-6 6h-2c-2 0-3-1-4-3l-4-5a2 2 0 0 1 3-2l1 2Z"/></svg>';
    overlay.appendChild(handBadge);
    ui.container.appendChild(overlay);
  }

  function recoveryPose(citizen: Citizen, name: PartName): PartPose {
    const recovery = citizen.recovery!,
      time = recovery.elapsed,
      heading = new THREE.Quaternion().setFromAxisAngle(axisY, citizen.heading);
    const floorPose = (stage: 'prone' | 'kneel' | 'stand'): PartPose => {
      let offset: [number, number, number] = dimensions[name].offset,
        angle = 0;
      if (stage === 'prone') {
        const offsets: Record<PartName, [number, number, number]> = {
          torso: [0, 0.072, 0],
          head: [0, 0.072, 0.175],
          leftArm: [-0.12, 0.038, 0.025],
          rightArm: [0.12, 0.038, 0.025],
          leftLeg: [-0.049, 0.043, -0.2],
          rightLeg: [0.049, 0.043, -0.2],
        };
        offset = offsets[name];
        angle = Math.PI / 2;
      } else if (stage === 'kneel') {
        const offsets: Record<PartName, [number, number, number]> = {
          torso: [0, 0.22, 0.015],
          head: [0, 0.391, 0.075],
          leftArm: [-0.105, 0.135, 0.08],
          rightArm: [0.105, 0.135, 0.08],
          leftLeg: [-0.049, 0.076, -0.053],
          rightLeg: [0.049, 0.076, -0.053],
        };
        offset = offsets[name];
        angle =
          name === 'torso' ? -0.3 : name === 'head' ? -0.1 : name.includes('Arm') ? -0.85 : 1.1;
      }
      return {
        position: new THREE.Vector3(...offset)
          .multiplyScalar(citizen.scale)
          .applyQuaternion(heading)
          .add(citizen.position),
        quaternion: heading
          .clone()
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle)),
      };
    };
    const start = time < 0.5 ? recovery.from[name] : floorPose(time < 1.2 ? 'prone' : 'kneel'),
      end = floorPose(time < 0.5 ? 'prone' : time < 1.2 ? 'kneel' : 'stand');
    const raw = clamp(
        time < 0.5
          ? time / 0.5
          : time < 1.2
            ? (time - 0.5) / 0.7
            : (time - 1.2) / (GET_UP_SECONDS - 1.2),
        0,
        1,
      ),
      t = raw * raw * (3 - 2 * raw);
    return {
      position: start.position.clone().lerp(end.position, t),
      quaternion: start.quaternion.clone().slerp(end.quaternion, t),
    };
  }

  function headPosition(citizen: Citizen): THREE.Vector3 {
    if (citizen.ragdoll) {
      const p = citizen.ragdoll.bodies.head.position;
      return new THREE.Vector3(p.x, p.y, p.z);
    }
    if (citizen.recovery) return recoveryPose(citizen, 'head').position;
    return citizen.position.clone().add(new THREE.Vector3(0, 0.55 * citizen.scale, 0));
  }

  function updateUi(): void {
    if (!overlay || !ui) return;
    overlay.style.display = uiVisible ? 'block' : 'none';
    if (!uiVisible) return;
    const camera = ui.getCamera(),
      width = ui.container.clientWidth,
      height = ui.container.clientHeight;
    const project = (citizen: Citizen, element: HTMLElement, offset: number) => {
      const point = headPosition(citizen).project(camera);
      const visible =
        point.z >= -1 && point.z <= 1 && Math.abs(point.x) < 1.08 && Math.abs(point.y) < 1.08;
      element.style.display = visible ? 'block' : 'none';
      if (visible) {
        element.style.left = `${(point.x * 0.5 + 0.5) * width}px`;
        element.style.top = `${(-point.y * 0.5 + 0.5) * height - offset}px`;
      }
    };
    const selected = held?.citizen ?? hovered;
    if (handBadge) {
      if (enabled && selected && !selected.dead) project(selected, handBadge, 12);
      else handBadge.style.display = 'none';
    }
    const active = dialogue.getActive(elapsed),
      ids = new Set(active.map((speech) => speech.actorId));
    for (const [id, node] of bubbleNodes)
      if (!ids.has(id)) {
        node.element.remove();
        bubbleNodes.delete(id);
      }
    for (const speech of active) {
      const citizen = citizens.find((actor) => actor.id === speech.actorId && !actor.dead);
      if (!citizen) continue;
      let node = bubbleNodes.get(speech.actorId);
      if (!node) {
        const element = document.createElement('div'),
          label = document.createElement('span'),
          tail = document.createElement('span');
        element.className = 'citizen-speech';
        element.style.cssText =
          'position:absolute;width:max-content;max-width:188px;box-sizing:border-box;white-space:normal;overflow-wrap:break-word;padding:7px 10px;background:rgba(255,251,243,.96);color:#253d42;border:1px solid #d4d9ce;border-radius:9px 9px 9px 2px;box-shadow:0 3px 9px #17333924;font:500 12px/1.35 "DM Sans",system-ui,sans-serif;transform:translate(-50%,-100%);pointer-events:none;';
        tail.style.cssText =
          'position:absolute;bottom:-4px;left:12px;width:6px;height:6px;background:#fffbf3;border-right:1px solid #d4d9ce;border-bottom:1px solid #d4d9ce;transform:rotate(45deg);';
        element.append(label, tail);
        overlay.appendChild(element);
        node = { element, label, tail, text: '', width: 0, height: 0, maxWidth: 0 };
        bubbleNodes.set(speech.actorId, node);
      }
      const projected = headPosition(citizen).project(camera),
        visible =
          projected.z >= -1 &&
          projected.z <= 1 &&
          Math.abs(projected.x) < 1.08 &&
          Math.abs(projected.y) < 1.08;
      node.element.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      const maxWidth = Math.max(32, Math.min(188, width - 16));
      // Content width does not depend on the actor's distance from the screen
      // edge. Measure only new text or a changed viewport width, not every frame.
      if (node.text !== speech.text || node.maxWidth !== maxWidth || !node.width) {
        if (node.text !== speech.text) {
          node.label.textContent = speech.text;
          node.text = speech.text;
        }
        if (node.maxWidth !== maxWidth) {
          node.element.style.maxWidth = `${maxWidth}px`;
          node.maxWidth = maxWidth;
        }
        node.width = node.element.offsetWidth;
        node.height = node.element.offsetHeight;
      }
      if (node.element.dataset.reaction !== speech.kind)
        node.element.dataset.reaction = speech.kind;
      const actorX = (projected.x * 0.5 + 0.5) * width,
        actorY = (-projected.y * 0.5 + 0.5) * height,
        offset = selected?.id === citizen.id ? 45 : 16;
      const half = node.width / 2,
        centreX = clamp(
          actorX,
          Math.min(half + 8, width / 2),
          Math.max(width - half - 8, width / 2),
        );
      let bottom = actorY - offset;
      if (bottom < node.height + 8) bottom = actorY + offset + node.height;
      bottom = clamp(bottom, Math.min(node.height + 8, height - 8), Math.max(8, height - 8));
      node.element.style.left = `${centreX}px`;
      node.element.style.top = `${bottom}px`;
      node.tail.style.left = `${clamp(actorX - (centreX - half) - 3, 8, Math.max(8, node.width - 14))}px`;
      const pointsUp = actorY < bottom - node.height;
      node.tail.style.top = pointsUp ? '-4px' : 'auto';
      node.tail.style.bottom = pointsUp ? 'auto' : '-4px';
      node.tail.style.transform = pointsUp ? 'rotate(225deg)' : 'rotate(45deg)';
      node.element.style.opacity = `${Math.min(1, (speech.expiresAt - elapsed) / 0.35)}`;
    }
  }

  function witnessReaction(
    subject: Citizen,
    position: Vec,
    topic: CitizenDialogueTopic = 'witness',
  ): void {
    const witness = citizens
      .filter(
        (c) =>
          c !== subject &&
          !c.dead &&
          !c.ragdoll &&
          !c.recovery &&
          c.position.distanceTo(new THREE.Vector3(position.x, position.y, position.z)) < 6,
      )
      .sort(
        (a, b) =>
          a.position.distanceToSquared(subject.position) -
          b.position.distanceToSquared(subject.position),
      )[0];
    if (witness) say(witness, topic, 'witness');
  }

  function ground(x: number, z: number): number {
    return citizenSurfaceHeight(state, x, z) + 0.0012;
  }
  function nodePoint(index: number, id: number): THREE.Vector3 {
    const node = pedestrianGraph.byId.get(index);
    void id;
    return node ? new THREE.Vector3(node.x, ground(node.x, node.z), node.z) : new THREE.Vector3();
  }
  function nearestWalkNode(x: number, z: number, preferred?: number): number | null {
    const nearest = pedestrianGraph.nearest(x, z, preferred);
    if (nearest !== null && nodeSet.has(nearest)) return nearest;
    // A clipped active area can contain an isolated inside corner. Do not
    // attach a returning resident to a node from which no walking edge exists.
    let best: number | null = null,
      distance = Infinity;
    for (const id of nodes) {
      const point = pedestrianGraph.byId.get(id)!,
        d = (point.x - x) ** 2 + (point.z - z) ** 2;
      if (d < distance) {
        best = id;
        distance = d;
      }
    }
    return best;
  }
  function walkSegmentClear(from: { x: number; z: number }, to: { x: number; z: number }): boolean {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    if (distance > 2.5) return false;
    const steps = Math.max(1, Math.ceil(distance / 0.025));
    for (let i = 0; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps,
        z = from.z + ((to.z - from.z) * i) / steps;
      const gx = Math.floor(x + state.size / 2),
        gz = Math.floor(z + state.size / 2);
      if (gx < 0 || gz < 0 || gx >= state.size || gz >= state.size) return false;
      if (
        walkingCollisions.tileCollides(gz * state.size + gx, x, z, 0, pedestrianBody, ground(x, z))
      )
        return false;
    }
    return true;
  }
  function reconnectWalker(citizen: Citizen): void {
    const nearby = nodes
      .map((id) => ({ id, point: pedestrianGraph.byId.get(id)! }))
      .map((entry) => ({
        ...entry,
        distance: Math.hypot(
          entry.point.x - citizen.position.x,
          entry.point.z - citizen.position.z,
        ),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 24);
    const reachable = nearby.find((entry) => walkSegmentClear(citizen.position, entry.point));
    const destination = reachable ?? nearby[0];
    if (!destination) return;
    const currentTile =
      state.tiles[
        Math.floor(citizen.position.z + state.size / 2) * state.size +
          Math.floor(citizen.position.x + state.size / 2)
      ];
    if (
      !reachable &&
      currentTile &&
      walkingCollisions.tileCollides(
        currentTile.z * state.size + currentTile.x,
        citizen.position.x,
        citizen.position.z,
        0,
        pedestrianBody,
        ground(citizen.position.x, citizen.position.z),
      )
    ) {
      // A construction edit can put a wall directly on an existing walker.
      // Resolve that overlap once; never animate a route through the new wall.
      citizen.position.copy(nodePoint(destination.id, citizen.id));
    } else if (!reachable) {
      citizen.node = -1;
      citizen.from.copy(citizen.position);
      citizen.to.copy(citizen.position);
      citizen.progress = 1;
      citizen.waitUntil = elapsed + 1;
      return;
    }
    citizen.node = destination.id;
    citizen.previous = -1;
    citizen.crossing = false;
    citizen.from.copy(citizen.position);
    citizen.to.copy(nodePoint(destination.id, citizen.id));
    citizen.progress = 0;
  }
  function nextNode(citizen: Citizen): void {
    if (!nodeSet.has(citizen.node)) {
      reconnectWalker(citizen);
      return;
    }
    const decision = life.step(citizen.id, citizen.node);
    if (decision.waiting) {
      citizen.crossing = false;
      citizen.from.copy(citizen.position);
      citizen.to.copy(citizen.position);
      citizen.progress = 1;
      return;
    }
    const selected = decision.edge,
      next = selected?.node ?? citizen.node;
    citizen.crossing = selected?.crosswalk ?? false;
    citizen.previous = citizen.node;
    citizen.node = next;
    citizen.from.copy(citizen.position);
    citizen.to.copy(nodePoint(next, citizen.id));
    citizen.progress = 0;
  }
  function sampleSpawnNode(sample: number): number {
    const target = sample * spawnWeightTotal;
    let low = 0,
      high = spawnWeights.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (spawnWeights[mid] < target) low = mid + 1;
      else high = mid;
    }
    return nodes[low];
  }
  function spawn(): void {
    const target = Math.min(
      MAX_CITIZENS,
      state.stats.population,
      Math.max(state.stats.population > 0 ? 24 : 0, Math.ceil(state.stats.population / 28)),
    );
    while (citizens.length < target && nodes.length) {
      const id = ++sequence,
        node = sampleSpawnNode(random(id * 7 + state.seed)),
        position = nodePoint(node, id);
      const citizen: Citizen = {
        id,
        node,
        previous: -1,
        position,
        from: position.clone(),
        to: position.clone(),
        progress: 0,
        heading: random(id) * Math.PI * 2,
        scale: CITIZEN_SCALE * (0.96 + random(id * 11) * 0.055),
        pace: 0.11 + random(id * 31) * 0.05,
        phase: random(id * 43) * 6.3,
        gaitBlend: state.speed > 0 ? 1 : 0,
        variant: id % 120,
        ragdoll: null,
        recovery: null,
        crossing: false,
        waitUntil: 0,
        dead: false,
      };
      citizens.push(citizen);
      nextNode(citizen);
      citizen.progress = random(id * 53);
      citizen.position.lerpVectors(citizen.from, citizen.to, citizen.progress);
    }
    if (citizens.length > target)
      for (let i = citizens.length - 1; i >= 0 && citizens.length > target; i--)
        if (!citizens[i].ragdoll && !citizens[i].recovery) {
          dialogue.forget(citizens[i].id);
          life.forget(citizens[i].id);
          citizens.splice(i, 1);
        }
  }
  function rebuildNodes(): void {
    // Restrict crowds to roads and parks near occupied lots; wilderness roads stay quiet.
    const active = new Set<number>();
    const activity = new Float32Array(state.tiles.length);
    for (const tile of state.tiles)
      if (['residential', 'commercial', 'industrial'].includes(tile.kind) && tile.level > 0) {
        for (let dz = -3; dz <= 3; dz++)
          for (let dx = -3; dx <= 3; dx++) {
            const x = tile.x + dx,
              z = tile.z + dz;
            if (x >= 0 && z >= 0 && x < state.size && z < state.size) {
              const index = z * state.size + x;
              active.add(index);
              const frontage =
                tile.kind === 'commercial' ? 3 : tile.kind === 'residential' ? 2 : 0.12;
              activity[index] +=
                (frontage * (1 + tile.level * 0.45)) / (1 + Math.abs(dx) + Math.abs(dz));
            }
          }
      }
    const activeTiles = state.tiles
      .filter(
        (t) =>
          (t.kind === 'road' || t.kind === 'park') &&
          t.elevation >= 0 &&
          t.fire === 0 &&
          active.has(t.z * state.size + t.x),
      )
      .map((t) => t.z * state.size + t.x);
    let checksum = 2166136261;
    for (const index of activeTiles) {
      const tile = state.tiles[index];
      checksum = Math.imul(checksum ^ index, 16777619);
      checksum = Math.imul(checksum ^ Math.round(tile.elevation * 10), 16777619);
      checksum = Math.imul(checksum ^ (tile.kind === 'park' ? tile.variation + 1 : 0), 16777619);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = tile.x + dx,
          z = tile.z + dz;
        const neighbor =
          x >= 0 && z >= 0 && x < state.size && z < state.size
            ? state.tiles[z * state.size + x]
            : undefined;
        checksum = Math.imul(
          checksum ^
            (neighbor && neighbor.level > 0 && neighbor.fire === 0
              ? ['residential', 'commercial', 'industrial'].indexOf(neighbor.kind) + 1
              : 0),
          16777619,
        );
        checksum = Math.imul(
          checksum ^
            (x >= 0 &&
            z >= 0 &&
            x < state.size &&
            z < state.size &&
            ['road', 'airport', 'seaport'].includes(state.tiles[z * state.size + x].kind)
              ? 1
              : 0),
          16777619,
        );
      }
    }
    const newRouteSignature = `${state.size}:${activeTiles.length}:${checksum}`;
    const routeChanged = newRouteSignature !== routeSignature;
    if (routeChanged) {
      pedestrianGraph = createPedestrianGraph(state, activeTiles, {
        blocked: (index, x, z) =>
          !!walkingCollisions.tileCollides(index, x, z, 0, pedestrianBody, ground(x, z)),
      });
      routeSignature = newRouteSignature;
    }
    nodes = pedestrianGraph.nodes
      .filter((node) => pedestrianGraph.neighbors(node.id).length > 0)
      .map((node) => node.id);
    const nodesPerTile = new Map<number, number>();
    for (const node of nodes) {
      const tile = pedestrianGraph.byId.get(node)!.tile;
      nodesPerTile.set(tile, (nodesPerTile.get(tile) ?? 0) + 1);
    }
    spawnWeightTotal = 0;
    spawnWeights = nodes.map((node) => {
      const tile = pedestrianGraph.byId.get(node)!.tile;
      spawnWeightTotal += Math.max(0.01, activity[tile]) / (nodesPerTile.get(tile) ?? 1);
      return spawnWeightTotal;
    });
    nodeSet.clear();
    for (const node of nodes) nodeSet.add(node);
    life.update(state, pedestrianGraph, nodeSet);
    police = state.tiles
      .filter((t) => t.kind === 'police' && (t.anchor < 0 || t.anchor === t.z * state.size + t.x))
      .map(
        (t) => new THREE.Vector3(t.x - state.size / 2 + 1, t.elevation, t.z - state.size / 2 + 1),
      );
    if (routeChanged)
      for (const citizen of citizens)
        if (
          !citizen.ragdoll &&
          !citizen.recovery &&
          nodes.length &&
          (!nodeSet.has(citizen.node) || !walkSegmentClear(citizen.position, citizen.to))
        )
          reconnectWalker(citizen);
  }
  function updateDecals(): void {
    const incidents = state.citizenEffects?.incidents ?? [],
      key = incidents.map((i) => `${i.id}:${i.x}:${i.y}:${i.z}`).join('|');
    if (key === decalSignature) return;
    decalSignature = key;
    for (const child of [...decals.children]) {
      (child as THREE.Mesh).geometry.dispose();
      decals.remove(child);
    }
    for (const incident of incidents.slice(-64)) {
      if (incident.kind !== 'impact') continue;
      const shape = new THREE.Shape(),
        count = 44,
        shapes: THREE.Shape[] = [shape],
        seed = incident.id * 37;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2,
          radius = 0.049 + random(seed + i) * 0.029 + (i % 9 === 0 ? 0.022 : 0);
        const x = Math.cos(angle) * radius * 1.12,
          y = Math.sin(angle) * radius * 0.77;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      // Sparse tiny satellite droplets and two thin smears, all in one mesh.
      for (let drop = 0; drop < 18; drop++) {
        const angle = random(seed + drop * 11) * Math.PI * 2,
          distance = 0.067 + random(seed + drop * 19) * 0.081,
          radius = 0.0025 + random(seed + drop * 23) * 0.006;
        const cx = Math.cos(angle) * distance,
          cy = Math.sin(angle) * distance * 0.76,
          droplet = new THREE.Shape();
        for (let n = 0; n < 7; n++) {
          const a = (n / 7) * Math.PI * 2,
            r = radius * (0.72 + random(seed + drop + n) * 0.45),
            x = cx + Math.cos(a) * r,
            y = cy + Math.sin(a) * r;
          if (n === 0) droplet.moveTo(x, y);
          else droplet.lineTo(x, y);
        }
        droplet.closePath();
        shapes.push(droplet);
      }
      for (let smear = 0; smear < 2; smear++) {
        const sign = smear ? 1 : -1,
          streak = new THREE.Shape();
        streak.moveTo(sign * 0.035, -0.006);
        streak.lineTo(sign * 0.126, 0.008);
        streak.lineTo(sign * 0.067, 0.006);
        streak.lineTo(sign * 0.045, 0.012);
        streak.closePath();
        shapes.push(streak);
      }
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapes), splatMaterial),
        normal = new THREE.Vector3(incident.nx, incident.ny, incident.nz).normalize();
      mesh.quaternion.setFromUnitVectors(axisZ, normal);
      mesh.position
        .set(incident.x - state.size / 2, incident.y, incident.z - state.size / 2)
        .addScaledVector(normal, 0.0012);
      // Ground marks follow the actual local pavement/terrain, rather than
      // hovering as a flat disk across curb edges. Walls keep their contact plane.
      if (
        normal.y > 0.7 &&
        Math.abs(incident.y - citizenSurfaceHeight(state, mesh.position.x, mesh.position.z)) < 0.12
      ) {
        const positions = mesh.geometry.getAttribute('position'),
          inverse = mesh.quaternion.clone().invert(),
          vertex = new THREE.Vector3();
        for (let i = 0; i < positions.count; i++) {
          vertex
            .fromBufferAttribute(positions, i)
            .applyQuaternion(mesh.quaternion)
            .add(mesh.position);
          vertex.y = citizenSurfaceHeight(state, vertex.x, vertex.z) + 0.0012;
          vertex.sub(mesh.position).applyQuaternion(inverse);
          positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }
        positions.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
      mesh.name = `citizen-splatter-${incident.id}`;
      mesh.receiveShadow = true;
      decals.add(mesh);
    }
  }
  function update(next: CityState, reset = false): void {
    if (reset || next.seed !== state.seed || next.size !== state.size || next.month < state.month) {
      // Worker results are immutable snapshots of the SAME city. They must not
      // remove held people or falling bodies at every economy tick. Only an
      // explicit replacement, another world, or a clock rollback resets actors.
      for (const citizen of citizens) citizen.ragdoll?.dispose();
      citizens.length = 0;
      pending.length = 0;
      particles.length = 0;
      held = null;
      hovered = null;
      for (const value of statics.values()) world.removeBody(value.body);
      statics.clear();
      impactDebris.clear();
      sequence = 0;
      spawnClock = 0;
      graphSignature = '';
      routeSignature = '';
      dialogue.clear();
      life.reset();
      clearEventVenue();
      lifeClock = 0;
      speechSelector.clear();
      vehicleContacts.clear();
      observationCooldown.clear();
      observationAttempts.clear();
      vehicleAwareness.clear();
      actorIndex.clear();
      nextComment = elapsed + 16;
      lastObservation = -Infinity;
      previousKinds = next.tiles.map((tile) => tile.kind);
      previousWeather = next.settings.weather;
    }
    state = next;
    walkingCollisions.setState(state);
    // Revision changes during simulation include growth/road edits; lightweight graph
    // construction occurs on state updates, never once per rendered frame.
    const key = `${state.revision}:${state.stats.population}:${state.size}`;
    if (key !== graphSignature) {
      graphSignature = key;
      rebuildNodes();
      if (!sequence || spawnClock > 18) {
        spawn();
        spawnClock = 0;
      }
    }
    syncEventVenue(true);
    let observations = 0;
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i],
        before = previousKinds[i];
      if (before !== undefined && before !== tile.kind && observations < 4) {
        notifyObservation({
          topic: ['empty', 'rubble'].includes(tile.kind)
            ? 'demolition'
            : tile.kind === 'tree'
              ? 'trees'
              : tile.kind === 'park'
                ? 'park'
                : 'construction',
          position: {
            x: tile.x - state.size / 2 + 0.5,
            y: tile.elevation,
            z: tile.z - state.size / 2 + 0.5,
          },
          id: `${state.revision}:${i}`,
        });
        observations++;
      }
      previousKinds[i] = tile.kind;
    }
    if (previousWeather !== state.settings.weather) {
      const citizen = citizens.find((c) => !c.dead && !c.ragdoll);
      if (citizen) say(citizen, state.settings.weather === 'rain' ? 'rain' : 'sun', 'observation');
      previousWeather = state.settings.weather;
    }
    updateDecals();
    renderCitizens();
    rebuildActorIndex();
  }

  function ensureColliders(): void {
    const required = new Set<string>();
    const sources = [
      ...citizens.filter((c) => c.ragdoll).map((c) => c.ragdoll!.position),
      ...impactDebris.positions,
    ];
    for (const p of sources) {
      const gx = Math.floor(p.x + state.size / 2),
        gz = Math.floor(p.z + state.size / 2);
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = gx + dx,
            z = gz + dz;
          if (x < 0 || z < 0 || x >= state.size || z >= state.size) continue;
          const tile = state.tiles[z * state.size + x],
            key = `g:${x}:${z}`,
            signature = `${tile.elevation}:${tile.kind}:${state.revision}`;
          required.add(key);
          if (statics.get(key)?.signature !== signature) {
            const old = statics.get(key);
            if (old) world.removeBody(old.body);
            const body = createGroundCollider(state, x, z);
            statics.set(key, { body, signature });
            world.addBody(body);
          }
          const anchor = tile.anchor >= 0 ? state.tiles[tile.anchor] : tile,
            buildingKey = `b:${anchor.x}:${anchor.z}`,
            buildingSignature = `${anchor.kind}:${anchor.level}:${anchor.elevation}:${anchor.rotation}:${anchor.variation}:${anchor.lotWidth ?? 1}:${anchor.lotDepth ?? 1}:${anchor.ruralCommercial ?? false}:${facilityAccessSignature(state, anchor)}`;
          required.add(buildingKey);
          if (statics.get(buildingKey)?.signature !== buildingSignature) {
            const old = statics.get(buildingKey);
            if (old) world.removeBody(old.body);
            statics.delete(buildingKey);
            const body = createBuildingCollider(state, anchor);
            if (body) {
              statics.set(buildingKey, { body, signature: buildingSignature });
              world.addBody(body);
            }
          }
        }
    }
    for (const [key, value] of statics)
      if (!required.has(key)) {
        world.removeBody(value.body);
        statics.delete(key);
      }
  }

  function recover(citizen: Citizen, preferred?: Vec, animated = false): void {
    const physicalPose =
      animated && citizen.ragdoll
        ? (Object.fromEntries(
            PARTS.map((name) => {
              const body = citizen.ragdoll!.bodies[name];
              return [
                name,
                {
                  position: new THREE.Vector3(body.position.x, body.position.y, body.position.z),
                  quaternion: new THREE.Quaternion(
                    body.quaternion.x,
                    body.quaternion.y,
                    body.quaternion.z,
                    body.quaternion.w,
                  ),
                },
              ];
            }),
          ) as Record<PartName, PartPose>)
        : null;
    const p = preferred ?? citizen.ragdoll?.position ?? citizen.position;
    let x = clamp(p.x, -state.size / 2 + 0.1, state.size / 2 - 0.1),
      z = clamp(p.z, -state.size / 2 + 0.1, state.size / 2 - 0.1);
    const tile =
      state.tiles[Math.floor(z + state.size / 2) * state.size + Math.floor(x + state.size / 2)];
    const node = nearestWalkNode(x, z, citizen.node) ?? citizen.node;
    // Always reconnect at the landing neighbourhood, not the original route.
    // A roof/water drop needs a safe sidewalk, but valid open ground retains
    // the actual release point even far away from the pedestrian graph.
    if (nodes.length) {
      citizen.node = node;
      citizen.previous = -1;
      if (!tile || !['empty', 'road', 'park'].includes(tile.kind) || tile.elevation < 0) {
        const point = nodePoint(node, citizen.id);
        x = point.x;
        z = point.z;
      }
    }
    citizen.ragdoll?.dispose();
    citizen.ragdoll = null;
    citizen.position.set(x, ground(x, z), z);
    citizen.recovery = physicalPose ? { elapsed: 0, from: physicalPose } : null;
    citizen.from.copy(citizen.position);
    citizen.to.copy(citizen.position);
    citizen.progress = 1;
    if (nodes.length) reconnectWalker(citizen);
    if (physicalPose) {
      say(citizen, 'recovery', 'recovery');
      witnessReaction(citizen, citizen.position);
    }
  }
  function incident(
    citizen: Citizen,
    kind: 'impact' | 'abduction',
    point: Vec,
    normal: Vec,
    hit?: Hit,
  ): void {
    if (citizen.dead) return;
    witnessReaction(citizen, point);
    citizen.dead = true;
    dialogue.forget(citizen.id);
    speechSelector.forget(citizen.id);
    vehicleContacts.delete(citizen.id);
    const witnessed = isCitizenIncidentWitnessed(
      point,
      citizens
        .filter((c) => c !== citizen && !c.dead)
        .map((c) => c.ragdoll?.position ?? c.position),
      police,
    );
    if (kind === 'impact' && hit && citizen.ragdoll)
      impactDebris.spawn({
        bodies: citizen.ragdoll.bodies,
        scale: citizen.scale,
        colors: {
          skin: skins[citizen.variant % skins.length],
          shirt:
            heritageAppearance(citizen.variant)?.sweater ?? shirts[citizen.variant % shirts.length],
          pants: trousers[citizen.variant % trousers.length],
        },
        normal,
        speed: hit.speed,
        cause: hit.cause,
      });
    citizen.ragdoll?.dispose();
    citizen.ragdoll = null;
    if (held?.citizen === citizen) held = null;
    if (hovered === citizen) hovered = null;
    if (kind === 'impact')
      for (let i = 0; i < 16; i++) {
        const angle = random(citizen.id * 4 + i) * Math.PI * 2,
          radius = 0.18 + random(i * 13 + citizen.id) * 0.35;
        particles.push({
          position: new THREE.Vector3(point.x, point.y, point.z).addScaledVector(
            new THREE.Vector3(normal.x, normal.y, normal.z),
            0.008,
          ),
          velocity: new THREE.Vector3(
            Math.cos(angle) * radius,
            0.18 + random(i * 19) * 0.32,
            Math.sin(angle) * radius,
          ).addScaledVector(new THREE.Vector3(normal.x, normal.y, normal.z), 0.22),
          life: 0.18 + random(i * 37) * 0.24,
          color: i % 3 ? 0x7f302d : 0x4b2426,
        });
      }
    onIncident?.({
      x: clamp(point.x + state.size / 2, 0, state.size - 0.001),
      y: clamp(point.y, -15, 127),
      z: clamp(point.z + state.size / 2, 0, state.size - 0.001),
      nx: normal.x,
      ny: normal.y,
      nz: normal.z,
      witnessed,
      kind,
    });
    spawnClock = 0;
  }
  function choose(ray: THREE.Ray): Citizen | null {
    let best: Citizen | null = null,
      distance = Infinity;
    for (const citizen of citizens)
      if (!citizen.dead && !citizen.ragdoll && !citizen.recovery) {
        local.copy(citizen.position);
        local.y += 0.31 * citizen.scale;
        const along = ray.direction.dot(local.clone().sub(ray.origin));
        if (
          along < 0 ||
          along > distance ||
          ray.distanceSqToPoint(local) > CITIZEN_PICK_RADIUS ** 2
        )
          continue;
        best = citizen;
        distance = along;
      }
    if (!best) return null;
    // Sampling the ray's crossed grid cells is bounded, and structural bounds
    // are cached. Hidden residents cannot be selected through houses or hills.
    const checked = new Set<number>(),
      point = new THREE.Vector3(),
      hit = new THREE.Vector3(),
      offset = new THREE.Vector3(),
      box = new THREE.Box3();
    const end = Math.max(0, distance - 0.25 * best.scale);
    for (let along = 0; along < end; along += 0.45) {
      ray.at(along, point);
      const x = Math.floor(point.x + state.size / 2),
        z = Math.floor(point.z + state.size / 2);
      if (x < 0 || z < 0 || x >= state.size || z >= state.size) continue;
      if (point.y < ground(point.x, point.z) - 0.035) return null;
      const tile = state.tiles[z * state.size + x],
        anchor = tile.anchor >= 0 ? state.tiles[tile.anchor] : tile,
        index = anchor.z * state.size + anchor.x;
      if (checked.has(index)) continue;
      checked.add(index);
      offset.set(
        anchor.x - state.size / 2 + 0.5,
        anchor.elevation,
        anchor.z - state.size / 2 + 0.5,
      );
      for (const structuralBox of buildingBoxes(state, anchor)) {
        box.copy(structuralBox).translate(offset);
        if (ray.intersectBox(box, hit) && hit.distanceTo(ray.origin) < end) return null;
      }
    }
    return best;
  }
  function pointerDown(ray: THREE.Ray, cameraDirection: THREE.Vector3, time: number): boolean {
    if (!enabled || held) return false;
    const citizen = choose(ray);
    if (!citizen) return false;
    const active = citizens.filter((c) => c.ragdoll);
    if (active.length >= MAX_RAGDOLLS) recover(active[0]);
    const origin = citizen.position.clone();
    citizen.ragdoll = new CitizenRagdoll(world, origin, citizen.heading, citizen.scale, (hit) =>
      pending.push({ citizen, hit }),
    );
    const target = new THREE.Vector3(origin.x, origin.y + 0.32 * citizen.scale, origin.z);
    citizen.ragdoll.hold(target, ground);
    // Vertical camera-facing plane: an upward cursor movement really lifts the
    // person. Horizontal cursor movement carries them sideways through the city.
    const normal = new THREE.Vector3(cameraDirection.x, 0, cameraDirection.z).normalize();
    if (normal.lengthSq() < 0.001) normal.set(0, 0, -1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, target);
    const initialHit = ray.intersectPlane(plane, new THREE.Vector3()) ?? target;
    held = {
      citizen,
      plane,
      offset: target.clone().sub(initialHit),
      target,
      last: target.clone(),
      velocity: new THREE.Vector3(),
      lastTime: time,
      lastMotionTime: time,
      gesture: new ThrowGesture(),
    };
    held.gesture.reset(target, time);
    hovered = citizen;
    say(citizen, 'held', 'held');
    ensureColliders();
    return true;
  }
  function pointerMove(ray: THREE.Ray, time: number): boolean {
    if (!enabled) return false;
    if (!held) {
      hovered = choose(ray);
      return !!hovered;
    }
    const hit = ray.intersectPlane(held.plane, new THREE.Vector3());
    if (!hit) return true;
    hit.add(held.offset);
    const minimumY = ground(hit.x, hit.z) + 0.32 * held.citizen.scale + 0.002;
    const groundClamped = hit.y <= minimumY;
    hit.y = Math.max(minimumY, Math.min(hit.y, 50));
    const movement = hit.clone().sub(held.last);
    const gestureMovement = movement.clone();
    if (groundClamped) gestureMovement.y = 0;
    held.gesture.move(gestureMovement, time);
    // Pointer-up supplies the final coordinates again. A duplicate sample is
    // not a stopped hand: retain the recent real motion, but do not extend its
    // lifetime. A genuine pause still expires it in pointerUp below.
    if (movement.lengthSq() > 1e-10) {
      const dt = clamp((time - held.lastTime) / 1000, 0.008, 0.2);
      movement.divideScalar(dt);
      if (movement.length() > MAX_HAND_SPEED) movement.setLength(MAX_HAND_SPEED);
      held.velocity.copy(held.gesture.velocity(time, MAX_HAND_SPEED));
      held.lastMotionTime = time;
    }
    // Pressing into support is placement intent. Neither a rejected downward
    // motion nor an uphill support correction becomes vertical throw momentum.
    if (groundClamped) held.velocity.y = 0;
    held.last.copy(hit);
    held.lastTime = time;
    held.target.copy(hit);
    held.citizen.ragdoll?.move(hit);
    return true;
  }
  function pointerUp(time: number): boolean {
    if (!held) return false;
    const current = held;
    held = null;
    const citizen = current.citizen,
      ragdoll = citizen.ragdoll;
    if (!ragdoll) return true;
    const p = ragdoll.position;
    current.velocity.copy(current.gesture.velocity(time, MAX_HAND_SPEED));
    if (Math.abs(p.x) > state.size / 2 || Math.abs(p.z) > state.size / 2) {
      incident(citizen, 'abduction', p, { x: 0, y: 1, z: 0 });
      return true;
    }
    ragdoll.clearGroundPenetration(ground);
    if (isGentleRelease(p, ground(p.x, p.z), current.velocity, citizen.scale)) recover(citizen);
    else {
      ragdoll.release(current.velocity);
      if (current.velocity.length() > 1.2) say(citizen, 'thrown', 'vehicle');
    }
    return true;
  }
  function rebaseHeldCamera(ray: THREE.Ray, direction: THREE.Vector3, time: number): void {
    if (!held) return;
    const normal = new THREE.Vector3(direction.x, 0, direction.z).normalize();
    if (normal.lengthSq() < 0.001) normal.set(0, 0, -1);
    held.plane.setFromNormalAndCoplanarPoint(normal, held.target);
    const hit = ray.intersectPlane(held.plane, new THREE.Vector3());
    if (hit) held.offset.copy(held.target).sub(hit);
    held.last.copy(held.target);
    held.lastTime = time;
    held.velocity.set(0, 0, 0);
    held.gesture.reset(held.target, time);
  }
  function cancel(): void {
    if (held) {
      const current = held;
      held = null;
      // Escape, capture loss and tool changes stop carrying at the actual
      // location. They must never teleport the resident back to pickup.
      current.citizen.ragdoll?.clearGroundPenetration(ground);
      recover(current.citizen);
    }
    hovered = null;
    if (handBadge) handBadge.style.display = 'none';
    renderCitizens();
  }
  function drawPart(
    name: string,
    index: number,
    position: THREE.Vector3,
    q: THREE.Quaternion,
    sx: number,
    sy: number,
    sz: number,
    c: number,
  ): void {
    const mesh = meshes.get(name)!;
    dummy.position.copy(position);
    dummy.quaternion.copy(q);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    color.set(c);
    mesh.setColorAt(index, color);
  }
  const limbStart = new THREE.Vector3(),
    limbEnd = new THREE.Vector3(),
    limbJoint = new THREE.Vector3(),
    limbScratch = new THREE.Vector3(),
    limbForward = new THREE.Vector3(),
    limbCentre = new THREE.Vector3(),
    limbRotation = new THREE.Quaternion(),
    limbBasisInverse = new THREE.Quaternion(),
    limbUp = new THREE.Vector3(0, 1, 0);
  function renderCitizens(): void {
    let index = 0,
      distantIndex = 0;
    for (const citizen of citizens)
      if (!citizen.dead) {
        // Simulation keeps every pedestrian. Only small visual detail outside a
        // generous camera margin is omitted; interaction actors are never culled.
        const interactionDetail =
          !!citizen.ragdoll ||
          !!citizen.recovery ||
          citizen === held?.citizen ||
          citizen === hovered;
        if (renderCamera && !interactionDetail) {
          projectedCitizen.copy(citizen.position);
          projectedCitizen.y += 0.12;
          projectedCitizen.project(renderCamera);
          if (
            projectedCitizen.z < -1.1 ||
            projectedCitizen.z > 1.1 ||
            Math.abs(projectedCitizen.x) > 1.35 ||
            Math.abs(projectedCitizen.y) > 1.35
          )
            continue;
        }
        const s = citizen.scale,
          skin = skins[citizen.variant % skins.length],
          heritage = heritageAppearance(citizen.variant),
          shirt = heritage?.sweater ?? shirts[citizen.variant % shirts.length],
          pants = trousers[citizen.variant % trousers.length];
        const build = heritage ? 1.1 : [0.94, 1.04, 1.12][citizen.variant % 3];
        citizen.detailed =
          !renderCamera ||
          interactionDetail ||
          citizenUsesDetail(
            citizenScreenHeight(renderCamera, citizen.position, 0.58 * s, viewportHeight),
            citizen.detailed,
          );
        if (!citizen.detailed) {
          // Skip the detailed matrices, limb articulation and tiny surface marks entirely.
          // The same simulation actor still walks, collides, speaks and can be picked.
          dummy.position.copy(citizen.position);
          dummy.quaternion.setFromAxisAngle(axisY, citizen.heading);
          for (const [name, mesh] of lodMeshes) {
            dummy.scale.set(s * (name === 'upper' ? build : 1), s, s);
            dummy.updateMatrix();
            mesh.setMatrixAt(distantIndex, dummy.matrix);
            color.set(name === 'head' ? skin : name === 'lower' ? pants : shirt);
            mesh.setColorAt(distantIndex, color);
          }
          distantIndex++;
          continue;
        }
        const articulated = !!citizen.ragdoll || !!citizen.recovery;
        const gait = citizenWalkingGait(citizen.phase, s),
          blend = articulated ? 0 : citizen.gaitBlend;
        const legLengths: Partial<Record<PartName, number>> = {};
        const positions = {} as Record<PartName, THREE.Vector3>,
          rotations = {} as Record<PartName, THREE.Quaternion>;
        const heading = new THREE.Quaternion().setFromAxisAngle(axisY, citizen.heading);
        for (const name of PARTS) {
          const spec = dimensions[name],
            size = spec.size;
          const body = citizen.ragdoll?.bodies[name];
          if (body) {
            positions[name] = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
            rotations[name] = new THREE.Quaternion(
              body.quaternion.x,
              body.quaternion.y,
              body.quaternion.z,
              body.quaternion.w,
            );
          } else if (citizen.recovery) {
            const pose = recoveryPose(citizen, name);
            positions[name] = pose.position;
            rotations[name] = pose.quaternion;
          } else {
            rotations[name] = heading.clone();
            if (name.includes('Leg')) {
              const foot = name === 'leftLeg' ? gait.left : gait.right;
              const forward = foot.forward * blend,
                footY = 0.021 * s + foot.lift * blend,
                hipY = 0.21 * s;
              legLengths[name] = Math.hypot(hipY - footY, forward);
              rotations[name].multiply(
                new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(1, 0, 0),
                  Math.atan2(-forward, hipY - footY),
                ),
              );
              positions[name] = new THREE.Vector3(
                spec.offset[0] * s,
                (hipY + footY) / 2,
                forward / 2,
              )
                .applyQuaternion(heading)
                .add(citizen.position);
            } else if (name.includes('Arm')) {
              const social = life.getActorStatus(citizen.id)?.activity === 'socialising';
              const swing = social
                ? -0.8 + Math.sin(lifeClock * 4 + citizen.id) * 0.3
                : Math.cos(citizen.phase) * 0.34 * blend * (name === 'leftArm' ? 1 : -1);
              rotations[name].multiply(
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), swing),
              );
              positions[name] = new THREE.Vector3(0, (-size[1] * s) / 2, 0)
                .applyQuaternion(rotations[name])
                .add(
                  new THREE.Vector3(
                    (name === 'leftArm' ? -0.078 : 0.078) * s * build,
                    0.415 * s,
                    0,
                  ).applyQuaternion(heading),
                )
                .add(citizen.position);
            } else {
              positions[name] = new THREE.Vector3(...spec.offset)
                .multiplyScalar(s)
                .applyQuaternion(heading)
                .add(citizen.position);
              positions[name].y += Math.abs(Math.sin(citizen.phase)) * 0.003 * s * blend;
            }
          }
          // Bring the sleeves into the shoulder seam; the physical joints retain their tested envelope.
          if (articulated && name.includes('Arm'))
            positions[name].add(
              new THREE.Vector3(name === 'leftArm' ? 0.042 : -0.042, -0.012, 0)
                .multiplyScalar(s)
                .applyQuaternion(rotations[name]),
            );
          if (name.includes('Arm') || name.includes('Leg')) {
            const length = legLengths[name] ?? size[1] * s;
            limbStart
              .set(0, length / 2, 0)
              .applyQuaternion(rotations[name])
              .add(positions[name]);
            limbEnd
              .set(0, -length / 2, 0)
              .applyQuaternion(rotations[name])
              .add(positions[name]);
            limbForward.set(0, 0, 1).applyQuaternion(heading);
            citizenLimbJoint(
              limbStart,
              limbEnd,
              limbForward,
              (name.includes('Leg') ? 0.108 : 0.113) * s,
              articulated ? 0 : name.includes('Arm') ? -1 : 1,
              limbJoint,
              limbScratch,
            );
            const segment = (slot: string, a: THREE.Vector3, b: THREE.Vector3, width: number) => {
              limbScratch.subVectors(a, b);
              const segmentLength = limbScratch.length();
              limbBasisInverse.copy(rotations[name]).invert();
              limbRotation
                .setFromUnitVectors(
                  limbUp,
                  limbScratch.normalize().applyQuaternion(limbBasisInverse),
                )
                .premultiply(rotations[name]);
              limbCentre.copy(a).add(b).multiplyScalar(0.5);
              drawPart(
                slot,
                index,
                limbCentre,
                limbRotation,
                size[0] * s * width,
                segmentLength + 0.008 * s,
                size[2] * s * width,
                name.includes('Leg') ? pants : shirt,
              );
            };
            segment(name, limbStart, limbJoint, 1);
            segment(
              name.replace('Arm', 'ForeArm').replace('Leg', 'LowerLeg'),
              limbJoint,
              limbEnd,
              0.86,
            );
            if (name.includes('Arm')) {
              // Existing hand/cuff offsets are measured from a full limb centre.
              // Rebase this virtual parent onto the bent forearm at the wrist.
              rotations[name].copy(limbRotation);
              positions[name]
                .set(0, (size[1] * s) / 2, 0)
                .applyQuaternion(limbRotation)
                .add(limbEnd);
            }
          } else
            drawPart(
              name,
              index,
              positions[name],
              rotations[name],
              size[0] * s * (name === 'head' ? 0.82 : name === 'torso' ? build : 1),
              legLengths[name] ?? size[1] * s * (name === 'head' ? 0.82 : 1),
              size[2] * s * (name === 'head' ? 0.9 : 1),
              name === 'head' ? skin : name.includes('Leg') ? pants : shirt,
            );
        }
        const detail = (
          name: string,
          parent: PartName,
          offset: [number, number, number],
          size: [number, number, number],
          c: number,
        ) => {
          if (!articulated && (name === 'leftShoe' || name === 'rightShoe')) {
            const foot = name === 'leftShoe' ? gait.left : gait.right;
            local
              .set(
                (name === 'leftShoe' ? -0.049 : 0.049) * s,
                0.02 * s + foot.lift * blend,
                foot.forward * blend + 0.015 * s,
              )
              .applyQuaternion(heading)
              .add(citizen.position);
            drawPart(name, index, local, heading, size[0] * s, size[1] * s, size[2] * s, c);
            return;
          }
          local
            .set(...offset)
            .multiplyScalar(s)
            .applyQuaternion(rotations[parent])
            .add(positions[parent]);
          drawPart(name, index, local, rotations[parent], size[0] * s, size[1] * s, size[2] * s, c);
        };
        const wearsHat = citizen.variant % 3 === 0;
        detail(
          'hat',
          'head',
          [0, 0.066, 0],
          wearsHat ? [0.12, 0.036, 0.128] : [0, 0, 0],
          heritage ? 0x686282 : citizen.variant % 2 ? 0x9d8557 : shirt,
        );
        const longHair = citizen.variant % 5 === 1;
        detail(
          'hair',
          'head',
          longHair ? [0, -0.002, -0.029] : [0, 0.036, -0.009],
          longHair ? [0.09, 0.108, 0.072] : [0.092, 0.034, 0.094],
          hairs[citizen.variant % 4],
        );
        detail('nose', 'head', [0, -0.002, 0.044], [0.0136, 0.024, 0.0242], skin);
        detail('leftEye', 'head', [-0.019, 0.012, 0.038], [0.012, 0.00765, 0.009], 0xffffff);
        detail('rightEye', 'head', [0.019, 0.012, 0.038], [0.012, 0.00765, 0.009], 0xffffff);
        detail(
          'backpack',
          'torso',
          [0, 0.025, -0.068],
          citizen.variant % 4 === 0 ? [0.1, 0.13, 0.055] : [0, 0, 0],
          citizen.variant % 2 ? 0xa68a58 : 0x78573e,
        );
        detail('leftShoe', 'leftLeg', [0, -0.085, 0.015], [0.062, 0.04, 0.096], 0x354044);
        detail('rightShoe', 'rightLeg', [0, -0.085, 0.015], [0.062, 0.04, 0.096], 0x354044);
        detail(
          'shirtFront',
          'torso',
          [0, 0, 0],
          heritage || citizen.variant % 3 === 1 ? [0, 0, 0] : [build, 1, 1],
          shirt,
        );
        detail(
          'collar',
          'torso',
          [0, 0.085, 0.038],
          heritage || citizen.variant % 3 === 1 ? [0, 0, 0] : [1, 1, 1],
          0xded8c5,
        );
        detail('leftHand', 'leftArm', [0, -0.121, 0], [0.034, 0.037, 0.032], skin);
        detail('rightHand', 'rightArm', [0, -0.121, 0], [0.034, 0.037, 0.032], skin);
        detail('leftEar', 'head', [-0.044, -0.003, -0.006], [0.013, 0.024, 0.017], skin);
        detail('rightEar', 'head', [0.044, -0.003, -0.006], [0.013, 0.024, 0.017], skin);
        detail(
          'leftCuff',
          'leftArm',
          [0, -0.098, 0],
          [0.04, 0.017, 0.047],
          !heritage && citizen.variant % 3 === 0 ? 0xd6d4c3 : shirt,
        );
        detail(
          'rightCuff',
          'rightArm',
          [0, -0.098, 0],
          [0.04, 0.017, 0.047],
          !heritage && citizen.variant % 3 === 0 ? 0xd6d4c3 : shirt,
        );
        detail('neck', 'head', [0, -0.06, -0.002], [0.043, 0.035, 0.043], skin);
        detail('brows', 'head', [0, 0.005, 0], [0.957, 0.6525, 0.93], hairs[citizen.variant % 4]);
        detail('mouth', 'head', [0, -0.024, 0.041], [0.0207, 0.0026, 0.006], 0x885d51);
        detail(
          'garmentDetails',
          'torso',
          [0, 0, 0],
          heritage || citizen.variant % 3 === 1 ? [0, 0, 0] : [build, 1, 1],
          0x9f998c,
        );
        detail('eagleFront', 'torso', [0, 0, 0], heritage ? [build, 1, 1] : [0, 0, 0], 0x080808);
        detail('eagleBack', 'torso', [0, 0, 0], heritage ? [build, 1, 1] : [0, 0, 0], 0x080808);
        const bun = citizen.variant % 5 === 2,
          fringe = citizen.variant % 5 === 3;
        detail(
          'hairDetail',
          'head',
          bun ? [0, 0.02, -0.053] : longHair ? [0, 0.039, -0.006] : [-0.025, 0.034, 0.026],
          bun
            ? [0.042, 0.044, 0.044]
            : longHair
              ? [0.09, 0.033, 0.087]
              : fringe
                ? [0.043, 0.028, 0.04]
                : [0, 0, 0],
          hairs[citizen.variant % 4],
        );
        index++;
      }
    detailedCitizens = index;
    distantCitizens = distantIndex;
    renderedCitizens = index + distantIndex;
    for (const mesh of meshes.values()) {
      mesh.count = index;
      mesh.visible = index > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const mesh of lodMeshes.values()) {
      mesh.count = distantIndex;
      mesh.visible = distantIndex > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  function animate(dt: number, walking: boolean, hour = state.settings.timeOfDay): void {
    renderCamera = ui?.getCamera() ?? null;
    // The camera may depend on engine systems created after this constructor.
    const requestedHeight = ui?.getViewportHeight?.() ?? ui?.container.clientHeight;
    viewportHeight =
      requestedHeight && Number.isFinite(requestedHeight) && requestedHeight > 0
        ? requestedHeight
        : 720;
    dt = clamp(dt, 0, 0.05);
    elapsed += dt;
    if (walking) lifeClock += dt;
    life.advance(dt, walking, hour);
    syncEventVenue();
    spawnClock += dt;
    for (const citizen of citizens) {
      if (citizen.dead) continue;
      if (citizen.recovery) {
        citizen.recovery.elapsed += dt;
        if (citizen.recovery.elapsed >= GET_UP_SECONDS) {
          citizen.recovery = null;
          citizen.phase = 0;
        }
        continue;
      }
      if (citizen.ragdoll) {
        if (!citizen.ragdoll.held) citizen.ragdoll.age += dt;
        continue;
      }
      if (walking && citizen.progress >= 1) nextNode(citizen);
      const waiting = life.getActorStatus(citizen.id)?.waiting === true && citizen.progress >= 1;
      const moving =
        walking &&
        !waiting &&
        nodes.length > 0 &&
        elapsed >= citizen.waitUntil &&
        !crosswalkHasTraffic(citizen);
      citizen.gaitBlend = THREE.MathUtils.damp(citizen.gaitBlend, moving ? 1 : 0, 12, dt);
      if (!moving) continue;
      const beforeX = citizen.position.x,
        beforeZ = citizen.position.z;
      const crossingPace = citizen.crossing ? 1.6 : 1;
      const distance = Math.max(0.08, citizen.from.distanceTo(citizen.to));
      citizen.progress += (dt * citizen.pace * crossingPace) / distance;
      if (citizen.progress >= 1) {
        citizen.position.copy(citizen.to);
        nextNode(citizen);
      }
      citizen.position.lerpVectors(citizen.from, citizen.to, Math.min(1, citizen.progress));
      citizen.position.y = ground(citizen.position.x, citizen.position.z);
      citizen.phase +=
        (Math.hypot(citizen.position.x - beforeX, citizen.position.z - beforeZ) /
          (citizen.scale * 0.38)) *
        Math.PI *
        2;
      const dx = citizen.to.x - citizen.from.x,
        dz = citizen.to.z - citizen.from.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.001) {
        const desired = Math.atan2(dx, dz),
          delta = Math.atan2(
            Math.sin(desired - citizen.heading),
            Math.cos(desired - citizen.heading),
          );
        citizen.heading += delta * Math.min(1, dt * 12);
      }
    }
    if (citizens.some((c) => c.ragdoll) || impactDebris.activeCount > 0) {
      // Miniature torsos can cross a thin pane within a 120 Hz step at the
      // allowed throw speed. 240 Hz keeps displacement below torso + glass
      // thickness, avoiding missed facade contacts without thick fake walls.
      ensureColliders();
      world.step(CITIZEN_PHYSICS_STEP, dt, 16);
      for (const item of pending.splice(0))
        incident(item.citizen, 'impact', item.hit.point, item.hit.normal, item.hit);
      for (const citizen of citizens)
        if (citizen.ragdoll && !citizen.ragdoll.held) {
          const p = citizen.ragdoll.position;
          if (Math.abs(p.x) > state.size / 2 + 0.4 || Math.abs(p.z) > state.size / 2 + 0.4)
            incident(citizen, 'abduction', p, { x: 0, y: 1, z: 0 });
          else if (
            citizen.ragdoll.age > 0.8 &&
            citizen.ragdoll.resting &&
            !citizen.ragdoll.impacted
          )
            recover(citizen, undefined, true);
        }
    } else if (statics.size) {
      for (const value of statics.values()) world.removeBody(value.body);
      statics.clear();
    }
    for (let i = citizens.length - 1; i >= 0; i--)
      if (citizens[i].dead) {
        life.forget(citizens[i].id);
        citizens.splice(i, 1);
      }
    if (spawnClock > 20) {
      spawn();
      spawnClock = 0;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.velocity.y -= 5 * dt;
      p.position.addScaledVector(p.velocity, dt);
    }
    const count = Math.min(particles.length, 256);
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      dummy.position.copy(p.position);
      dummy.quaternion.identity();
      dummy.scale.setScalar(0.004 + 0.01 * clamp(p.life / 0.4, 0, 1));
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
      color.set(p.color);
      particleMesh.setColorAt(i, color);
    }
    particleMesh.count = count;
    if (count) {
      particleMesh.instanceMatrix.needsUpdate = true;
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    }
    if (walking && elapsed >= nextComment) {
      nextComment = elapsed + 18 + random(sequence + Math.floor(elapsed)) * 12;
      const walkingCitizens = citizens.filter(
        (c) =>
          !c.dead &&
          !c.ragdoll &&
          !c.recovery &&
          onScreen(c) &&
          dialogue.canSpeak(c.id, 'idle', elapsed),
      );
      const candidate =
        walkingCitizens[Math.floor(random(elapsed + state.seed) * walkingCitizens.length)];
      if (candidate) say(candidate, ambientTopic(candidate), 'idle');
    }
    impactDebris.update(dt);
    renderCitizens();
    rebuildActorIndex();
    updateUi();
  }
  life.advance(0, true, initialState.settings.timeOfDay);
  update(initialState);
  renderCitizens();
  return {
    group,
    update,
    animate,
    getLife: () => life.getSnapshot(),
    triggerEvent(kind, near) {
      const candidates = citizens
        .filter((c) => !c.dead && !c.ragdoll && !c.recovery)
        .map((c) => ({ id: c.id, node: c.node, x: c.position.x, z: c.position.z }));
      let preparedVenue: THREE.Group | null = null;
      const result = life.trigger(kind, near, candidates, (site) => {
        const venue = createCitizenEventVenue(state, site);
        if (!venue.userData.eventVenue.placed || !venue.children.length) {
          disposeCitizenEventVenue(venue);
          return false;
        }
        preparedVenue = venue;
        return true;
      });
      if (result.ok && preparedVenue) {
        clearEventVenue();
        eventVenue = preparedVenue;
        eventVenueSignature = venueSiteSignature(result.event);
        group.add(eventVenue);
      }
      return result;
    },
    stopEvent() {
      life.stopEvent();
      clearEventVenue();
    },
    pointerDown,
    pointerMove,
    pointerUp,
    rebaseHeldCamera,
    cancel,
    sweepVehicleImpact,
    notifyObservation,
    clearHover() {
      if (!held) {
        hovered = null;
        if (handBadge) handBadge.style.display = 'none';
      }
    },
    setEnabled(value) {
      if (!value) cancel();
      enabled = value;
    },
    setUiVisible(value) {
      uiVisible = value;
      if (overlay) overlay.style.display = value ? 'block' : 'none';
    },
    refreshLocale: updateUi,
    get holding() {
      return !!held;
    },
    get cursor() {
      return held ? 'grabbing' : hovered ? 'grab' : 'default';
    },
    getDebug() {
      return {
        count: citizens.length,
        rendered: renderedCitizens,
        detailed: detailedCitizens,
        distant: distantCitizens,
        debris: impactDebris.activeCount,
        ragdolls: citizens.filter((c) => c.ragdoll).length,
        recovering: citizens.filter((c) => c.recovery).length,
        held: held?.citizen.id ?? null,
        hovered: hovered?.id ?? null,
        speech: dialogue.getActive(elapsed),
        positions: citizens
          .filter((c) => !c.dead)
          .map((c) => {
            const p = c.ragdoll
              ? actorTorso(c).add(new THREE.Vector3(0, -0.32 * c.scale, 0))
              : c.position;
            return {
              id: c.id,
              x: p.x,
              y: p.y,
              z: p.z,
              crossing: c.crossing,
              state: c.recovery
                ? ('recovering' as const)
                : c.ragdoll?.held
                  ? ('held' as const)
                  : c.ragdoll
                    ? ('ragdoll' as const)
                    : ('walking' as const),
            };
          }),
      };
    },
    dispose() {
      impactDebris.dispose();
      walkingCollisions.dispose();
      cancel();
      for (const c of citizens) c.ragdoll?.dispose();
      for (const value of statics.values()) world.removeBody(value.body);
      statics.clear();
      for (const geometry of [
        cube,
        headGeometry,
        hatGeometry,
        torsoGeometry,
        limbGeometry,
        sleeveGeometry,
        shoeGeometry,
        backpackGeometry,
        handGeometry,
        rightHandGeometry,
        noseGeometry,
        eyeGeometry,
        earGeometry,
        cuffGeometry,
        hairGeometry,
        browGeometry,
        garmentGeometry,
        shirtFrontGeometry,
        mouthGeometry,
        collarGeometry,
        eagleFrontGeometry,
        eagleBackGeometry,
        particleGeometry,
        ...Object.values(lodGeometries),
      ])
        geometry.dispose();
      for (const material of [
        ...Object.values(materials),
        lodMaterial,
        splatMaterial,
        particleMaterial,
      ])
        material.dispose();
      for (const child of decals.children) (child as THREE.Mesh).geometry.dispose();
      dialogue.clear();
      life.reset();
      clearEventVenue();
      overlay?.remove();
      group.removeFromParent();
    },
  };
}
