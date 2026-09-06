import type { Point } from '../domain/types';
import { lanePose, lanePathLength } from './lanes';
import {
  planJunctionMovement,
  roadPointKey,
  sameRoadPoint,
  type JunctionMovement,
  type RoadNetwork,
} from './network';
import {
  type TrafficVehicle,
  type TrafficWaitReason,
  createTrafficController,
  STOP_LINE_OFFSET,
} from './controller';
import { findVehicleContact, type VehicleContactBody } from '../vehicles/contacts';

export interface TrafficRouteState {
  previous: Point;
  from: Point;
  to: Point;
  progress: number;
  turn: number;
  itinerary?: Point[];
  movement?: JunctionMovement;
  waiting?: TrafficWaitReason | 'vehicle';
  travelled?: number;
}
export type TrafficController = ReturnType<typeof createTrafficController>;
const random = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export function chooseTrafficExit(
  network: RoadNetwork,
  from: Point,
  previous: Point,
  turn: number,
): Point {
  const all = network.neighbors.get(roadPointKey(from)) ?? [];
  const forward = all.filter((p) => !sameRoadPoint(p, previous)),
    choices = forward.length ? forward : all;
  return choices[Math.floor(random(turn + from.x * 17 + from.z * 31) * choices.length)] ?? previous;
}
export function prepareTrafficRoute(
  car: TrafficRouteState,
  network: RoadNetwork,
  controller: TrafficController,
  id: number,
): void {
  if (
    car.movement &&
    network.approaches.get(car.movement.approachId)?.junctionId !== car.movement.junctionId
  ) {
    controller.cancel(id);
    car.movement = undefined;
    car.itinerary = [];
  }
  if (
    car.movement &&
    !controller.hasReservation(id) &&
    !network.junctionAt.has(roadPointKey(car.from)) &&
    !(
      car.from.x === network.approaches.get(car.movement.approachId)?.from.x &&
      car.from.z === network.approaches.get(car.movement.approachId)?.from.z
    )
  )
    car.movement = undefined;
  if (
    !car.movement &&
    !network.junctionAt.has(roadPointKey(car.from)) &&
    network.junctionAt.has(roadPointKey(car.to))
  ) {
    const m = planJunctionMovement(
      network,
      car.from,
      car.to,
      Math.floor(random(car.turn + car.from.x * 37) * 100000),
    );
    if (m) {
      car.movement = m;
      car.itinerary = m.path.slice(1);
    }
  }
}
const contactBody = (v: TrafficVehicle): VehicleContactBody => ({
  ...v,
  y: v.y ?? 0,
  vx: 0,
  vz: 0,
  angularVelocity: 0,
  mass: 1,
  height: 1,
});
/** Shared deterministic motion for scene and long-run tests. Coordinates are grid-space. */
export function advanceTrafficRoute(
  car: TrafficRouteState,
  id: number,
  speed: number,
  dt: number,
  network: RoadNetwork,
  controller: TrafficController,
  occupants: TrafficVehicle[],
  height: (x: number, z: number) => number = () => 0,
): ReturnType<typeof lanePose> {
  const own = occupants.find((v) => v.id === id)!;
  const before = {
    previous: car.previous,
    from: car.from,
    to: car.to,
    progress: car.progress,
    turn: car.turn,
    itinerary: car.itinerary?.slice(),
    movement: car.movement,
  };
  prepareTrafficRoute(car, network, controller, id);
  let distance = Math.max(0, speed * dt),
    pose = lanePose(car.previous, car.from, car.to, car.progress);
  car.waiting = null;
  while (distance > 1e-9) {
    const length = lanePathLength(car.previous, car.from, car.to),
      remaining = (1 - car.progress) * length;
    let permitted = distance;
    if (
      car.movement &&
      car.movement.approachId === `${roadPointKey(car.from)}>${roadPointKey(car.to)}`
    ) {
      const stop = Math.max(0, length - own.halfLength - (STOP_LINE_OFFSET - 0.5)),
        along = car.progress * length;
      if (along + distance >= stop) {
        const permission = controller.request(id, car.movement, own.halfLength, own.halfWidth);
        if (!permission.allowed) {
          permitted = Math.max(0, stop - along);
          car.waiting = permission.reason;
        }
      }
    }
    const step = Math.min(permitted, remaining);
    car.progress += step / length;
    distance -= step;
    if (step <= 1e-9 || car.waiting) {
      distance = 0;
      break;
    }
    if (car.progress >= 1 - 1e-8) {
      car.previous = car.from;
      car.from = car.to;
      car.to =
        car.itinerary?.shift() ?? chooseTrafficExit(network, car.from, car.previous, ++car.turn);
      car.progress = 0;
      if (!network.roads.has(roadPointKey(car.to))) {
        Object.assign(car, before);
        car.waiting = 'vehicle';
        break;
      }
      prepareTrafficRoute(car, network, controller, id);
    }
  }
  pose = lanePose(car.previous, car.from, car.to, car.progress);
  const desired = { ...own, x: pose.x, z: pose.z, y: height(pose.x, pose.z), yaw: pose.yaw };
  const blocked = occupants.some((other) => {
    if (other.id === id || Math.hypot(other.x - own.x, other.z - own.z) > 2) return false;
    const hit = findVehicleContact(contactBody(desired), contactBody(other));
    if (!hit) return false;
    const was = findVehicleContact(contactBody(own), contactBody(other));
    return !was || hit.penetration > was.penetration + 0.00001;
  });
  if (blocked) {
    Object.assign(car, before);
    car.waiting = 'vehicle';
    return lanePose(car.previous, car.from, car.to, car.progress);
  }
  car.travelled = (car.travelled ?? 0) + Math.hypot(pose.x - own.x, pose.z - own.z);
  Object.assign(own, desired);
  return pose;
}
