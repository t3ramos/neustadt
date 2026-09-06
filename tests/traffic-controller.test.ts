import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrafficController, mustYieldToSide, vehicleOccupiesJunction, type TrafficVehicle } from '../src/traffic-controller.ts';
import { buildRoadNetwork, planJunctionMovement, type JunctionMovement, type RoadNetwork, type TrafficApproach } from '../src/traffic-network.ts';
import type { Point, Tile } from '../src/types.ts';
import { interiorRoadNetwork } from './traffic-fixtures';

function tile([x, z]: [number, number]): Tile {
  return { x, z, kind: 'road', level: 0, variation: 0, powered: false, watered: false, connected: false, pollution: 0, landValue: 0,
    traffic: 0, fire: 0, age: 0, elevation: 0, hasPipe: false, hasPowerLine: false, anchor: -1, rotation: 0 };
}
const cross: [number, number][] = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]];
function roads(points: [number, number][] = cross): RoadNetwork { return interiorRoadNetwork(points); }
function vehicle(id: number, values: Partial<TrafficVehicle> = {}): TrafficVehicle {
  return { id, x: -3, z: -3, yaw: 0, halfWidth: .13, halfLength: .2, ...values };
}
function approachVehicle(id: number, a: TrafficApproach, values: Partial<TrafficVehicle> = {}): TrafficVehicle {
  return vehicle(id, { x: a.from.x + .5 - a.direction.z * .16, z: a.from.z + .5 + a.direction.x * .16,
    yaw: Math.atan2(a.direction.x, a.direction.z), ...values });
}
function movementFor(network: RoadNetwork, approach = network.junctions[0].approaches[0], exit?: Point): JunctionMovement {
  for (let choice = 0; choice < network.junctions[0].approaches.length; choice++) {
    const movement = planJunctionMovement(network, approach.from, approach.entry, choice); assert.ok(movement);
    if (!exit || (movement.exit.x === exit.x && movement.exit.z === exit.z)) return movement;
  }
  throw new Error('Requested exit is not reachable');
}
function afterExit(id: number, movement: JunctionMovement, distance = .5, values: Partial<TrafficVehicle> = {}): TrafficVehicle {
  const d = movement.exitDirection;
  return vehicle(id, { x: movement.exit.x + .5 + d.x * distance - d.z * .16,
    z: movement.exit.z + .5 + d.z * distance + d.x * .16, yaw: Math.atan2(d.x, d.z), ...values });
}

test('every incoming approach gets exactly one green phase, separated by yellow and all-red', () => {
  const network = roads(), controller = createTrafficController(network, { greenSeconds: 2, yellowSeconds: 1, allRedSeconds: .5 });
  const observed: string[] = [];
  for (let cycle = 0; cycle < 2; cycle++) for (const approach of network.junctions[0].approaches) {
    const states = controller.signalStates();
    assert.deepEqual(states.filter(s => s.color === 'green').map(s => s.approachId), [approach.id]);
    assert.equal(states.filter(s => s.color === 'red').length, 3); observed.push(approach.id);
    controller.update(2, []);
    assert.deepEqual(controller.signalStates().filter(s => s.color === 'yellow').map(s => s.approachId), [approach.id]);
    assert.equal(controller.signalStates().some(s => s.color === 'green'), false);
    controller.update(1, []); assert.ok(controller.signalStates().every(s => s.color === 'red'));
    controller.update(.5, []);
  }
  assert.equal(new Set(observed).size, 4);
  assert.deepEqual(observed.slice(0, 4), observed.slice(4));
});

test('red, yellow and clearance phases prohibit new reservations, then the next approach can proceed', () => {
  const network = roads(), controller = createTrafficController(network, { greenSeconds: 2, yellowSeconds: 1, allRedSeconds: .5 });
  const [first, second] = network.junctions[0].approaches;
  const a = approachVehicle(1, first), b = approachVehicle(2, second), firstMove = movementFor(network, first), secondMove = movementFor(network, second);
  controller.update(0, [a, b]);
  assert.deepEqual(controller.request(b.id, secondMove, b.halfLength), { allowed: false, reason: 'signal' });
  controller.update(2, [a, b]);
  assert.deepEqual(controller.request(a.id, firstMove, a.halfLength), { allowed: false, reason: 'signal' });
  controller.update(1, [a, b]);
  assert.deepEqual(controller.request(b.id, secondMove, b.halfLength), { allowed: false, reason: 'signal' });
  controller.update(.5, [a, b]);
  assert.deepEqual(controller.request(b.id, secondMove, b.halfLength), { allowed: true, reason: null });
});

test('four continuously waiting signal approaches each obtain admission within one complete cycle', () => {
  const network = roads(), controller = createTrafficController(network, { greenSeconds: 2, yellowSeconds: 1, allRedSeconds: 1 });
  const entries = network.junctions[0].approaches.map((a, i) => ({ car: approachVehicle(i + 1, a), movement: movementFor(network, a) }));
  const passed = new Set<number>();
  controller.update(0, entries.map(e => e.car));
  for (let phase = 0; phase < 4; phase++) {
    const waiting = entries.filter(e => !passed.has(e.car.id));
    const decisions = [...waiting].reverse().map(e => ({ ...e, result: controller.request(e.car.id, e.movement, e.car.halfLength) }));
    const admitted = decisions.filter(e => e.result.allowed); assert.equal(admitted.length, 1);
    const owner = admitted[0]; assert.equal(owner.car.id, phase + 1); passed.add(owner.car.id);
    const stillWaiting = entries.filter(e => !passed.has(e.car.id)).map(e => e.car);
    controller.update(.25, [...stillWaiting, vehicle(owner.car.id, { x: .5, z: .5 })]);
    controller.update(.25, [...stillWaiting, afterExit(owner.car.id, owner.movement, 3)]);
    controller.update(3.5, stillWaiting);
  }
  assert.equal(passed.size, 4); assert.equal(controller.getDebug().completed, 4);
});

test('phase timing is deterministic across frame subdivision and ignores invalid elapsed time', () => {
  const network = roads(), config = { greenSeconds: 2, yellowSeconds: 1, allRedSeconds: .5 };
  const whole = createTrafficController(network, config), frames = createTrafficController(network, config);
  whole.update(19.25, []); for (let i = 0; i < 77; i++) frames.update(.25, []);
  assert.deepEqual(whole.signalStates(), frames.signalStates());
  const before = frames.getDebug();
  for (const dt of [-1, NaN, Infinity]) frames.update(dt, []);
  assert.deepEqual(frames.getDebug(), before);
});

test('a green approach cannot send a second vehicle into an existing reservation', () => {
  const network = roads(), controller = createTrafficController(network), approach = network.junctions[0].approaches[0];
  const first = approachVehicle(1, approach), second = approachVehicle(2, approach, { x: -4, z: -4 }), movement = movementFor(network);
  controller.update(0, [first, second]); assert.equal(controller.request(first.id, movement, first.halfLength).allowed, true);
  assert.deepEqual(controller.request(second.id, movement, second.halfLength), { allowed: false, reason: 'junction' });
  assert.equal(controller.hasReservation(first.id), true); assert.equal(controller.hasReservation(second.id), false);
});

test('occupied junction reservations never expire by timeout or changing traffic lights', () => {
  const network = roads(), junction = network.junctions[0], controller = createTrafficController(network);
  const approach = junction.approaches[0], movement = movementFor(network), owner = approachVehicle(1, approach);
  controller.update(0, [owner]); assert.equal(controller.request(owner.id, movement, owner.halfLength).allowed, true);
  const stoppedInside = vehicle(owner.id, { x: .5, z: .5 });
  for (let i = 0; i < 300; i++) {
    controller.update(1, [stoppedInside]);
    assert.equal(controller.hasReservation(owner.id), true);
    assert.equal(controller.request(owner.id, movement, owner.halfLength).allowed, true, 'An admitted vehicle may always clear a changed light');
  }
  assert.equal(controller.getDebug().completed, 0); assert.equal(controller.getDebug().reservations[0].entered, true);
});

test('a long vehicle releases its reservation only after its rear clears the junction', () => {
  const network = roads(), controller = createTrafficController(network), movement = movementFor(network), owner = approachVehicle(1, network.junctions[0].approaches[0]);
  controller.update(0, [owner]); assert.equal(controller.request(owner.id, movement, .7).allowed, true);
  controller.update(.1, [vehicle(owner.id, { x: .5, z: .5, halfLength: .7 })]);
  const d = movement.exitDirection;
  const partial = afterExit(owner.id, movement, .1, { halfLength: .7 });
  assert.equal(vehicleOccupiesJunction(partial, network.junctions[0]), true);
  controller.update(1, [partial]); assert.equal(controller.hasReservation(owner.id), true);
  const cleared = { ...partial, x: partial.x + d.x * .2, z: partial.z + d.z * .2 };
  assert.equal(vehicleOccupiesJunction(cleared, network.junctions[0]), false);
  controller.update(1, [cleared]); assert.equal(controller.hasReservation(owner.id), false); assert.equal(controller.getDebug().completed, 1);
  controller.update(1, [cleared]); assert.equal(controller.getDebug().completed, 1);
});

test('a player parked inside the crossing blocks admission and traffic resumes when it leaves', () => {
  const network = roads(), controller = createTrafficController(network), movement = movementFor(network);
  const waiting = approachVehicle(1, network.junctions[0].approaches[0]), player = vehicle(99, { x: .5, z: .5, controlled: true });
  controller.update(0, [waiting, player]);
  assert.deepEqual(controller.request(waiting.id, movement, waiting.halfLength), { allowed: false, reason: 'junction' });
  controller.update(.1, [waiting, { ...player, x: 5, z: 5 }]);
  assert.equal(controller.request(waiting.id, movement, waiting.halfLength).allowed, true);
});

test('an occupied exit lane blocks green traffic before entry and reopens without manual cancellation', () => {
  const network = roads(), controller = createTrafficController(network), movement = movementFor(network);
  const waiting = approachVehicle(1, network.junctions[0].approaches[0]), player = afterExit(99, movement, 0, { controlled: true });
  assert.equal(vehicleOccupiesJunction(player, network.junctions[0]), false);
  controller.update(0, [waiting, player]);
  assert.equal(controller.exitBlocked(waiting.id, movement, waiting.halfLength, waiting.halfWidth), true);
  assert.deepEqual(controller.request(waiting.id, movement, waiting.halfLength), { allowed: false, reason: 'exit' });
  controller.update(.1, [waiting, { ...player, x: 5, z: 5 }]);
  assert.equal(controller.request(waiting.id, movement, waiting.halfLength).allowed, true);
});

test('exit storage accounts for truck length while opposing-lane traffic remains usable', () => {
  const network = roads(), controller = createTrafficController(network), movement = movementFor(network), d = movement.exitDirection;
  const farQueue = afterExit(99, movement, .65);
  controller.update(0, [farQueue]);
  assert.equal(controller.exitBlocked(1, movement, .2, .13), false);
  assert.equal(controller.exitBlocked(1, movement, .7, .13), true);
  const opposing = afterExit(98, movement, 0);
  opposing.x += d.z * .32; opposing.z -= d.x * .32; opposing.yaw += Math.PI;
  controller.update(0, [opposing]);
  assert.equal(controller.exitBlocked(1, movement, .2, .13), false);
});

test('occupied connecting tiles protect the entire cluster rather than only the nearest crossing', () => {
  const points: [number, number][] = [[-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [0, -1], [0, 1], [2, -1], [2, 1]];
  const network = roads(points), controller = createTrafficController(network), movement = movementFor(network);
  const waiting = approachVehicle(1, network.junctions[0].approaches[0]), inConnector = vehicle(99, { x: 1.5, z: .5 });
  controller.update(0, [waiting, inConnector]);
  assert.deepEqual(controller.request(waiting.id, movement, waiting.halfLength), { allowed: false, reason: 'junction' });
});

test('right and left priority are reciprocal and exclude following and oncoming approaches', () => {
  for (const direction of [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }]) {
    const fromRight = { x: direction.z, z: -direction.x }, fromLeft = { x: -direction.z, z: direction.x };
    assert.equal(mustYieldToSide(direction, fromRight, 'right'), true); assert.equal(mustYieldToSide(direction, fromLeft, 'right'), false);
    assert.equal(mustYieldToSide(direction, fromLeft, 'left'), true); assert.equal(mustYieldToSide(direction, fromRight, 'left'), false);
    for (const side of ['right', 'left'] as const) {
      assert.equal(mustYieldToSide(direction, direction, side), false);
      assert.equal(mustYieldToSide(direction, { x: -direction.x, z: -direction.z }, side), false);
    }
  }
});

test('unsignalled crossings honor the configured priority side after a blocked crossing reopens', () => {
  for (const side of ['right', 'left'] as const) {
    const network = roads(), controller = createTrafficController(network, { signalsEnabled: false, prioritySide: side });
    const a = network.junctions[0].approaches[0], b = network.junctions[0].approaches.find(other => mustYieldToSide(a.direction, other.direction, side))!;
    const first = approachVehicle(1, a), preferred = approachVehicle(2, b), firstMove = movementFor(network, a), preferredMove = movementFor(network, b);
    const obstruction = vehicle(99, { x: .5, z: .5 });
    controller.update(0, [first, preferred, obstruction]);
    controller.request(first.id, firstMove, first.halfLength); controller.request(preferred.id, preferredMove, preferred.halfLength);
    controller.update(.1, [first, preferred]);
    assert.deepEqual(controller.request(first.id, firstMove, first.halfLength), { allowed: false, reason: 'priority' });
    assert.equal(controller.request(preferred.id, preferredMove, preferred.halfLength).allowed, true);
  }
});

test('four-way priority ties choose a deterministic first vehicle and all queues eventually pass', () => {
  for (const prioritySide of ['right', 'left'] as const) {
    const network = roads(), controller = createTrafficController(network, { signalsEnabled: false, prioritySide });
    const entries = network.junctions[0].approaches.map((a, i) => ({ car: approachVehicle(i + 1, a), movement: movementFor(network, a) }));
    const obstruction = vehicle(99, { x: .5, z: .5 });
    controller.update(0, [...entries.map(e => e.car), obstruction]);
    for (const e of [...entries].reverse()) controller.request(e.car.id, e.movement, e.car.halfLength);
    controller.update(.1, entries.map(e => e.car));
    const passed: number[] = [];
    for (let iteration = 0; iteration < 4; iteration++) {
      const remaining = entries.filter(e => !passed.includes(e.car.id));
      const winner = remaining.find(e => controller.request(e.car.id, e.movement, e.car.halfLength).allowed);
      assert.ok(winner, 'Every remaining priority queue must make progress');
      if (!iteration) assert.equal(winner.car.id, 1);
      passed.push(winner.car.id);
      const otherCars = entries.filter(e => !passed.includes(e.car.id)).map(e => e.car);
      controller.update(.1, [...otherCars, vehicle(winner.car.id, { x: .5, z: .5 })]);
      controller.update(.1, [...otherCars, afterExit(winner.car.id, winner.movement, 3)]);
    }
    assert.equal(new Set(passed).size, 4); assert.equal(controller.getDebug().completed, 4);
  }
});

test('a four-way priority tie serves the longest wait before lower vehicle IDs', () => {
  const network = roads(), controller = createTrafficController(network, { signalsEnabled: false });
  const ids = [40, 10, 20, 30];
  const entries = network.junctions[0].approaches.map((a, i) => ({ car: approachVehicle(ids[i], a), movement: movementFor(network, a) }));
  const obstruction = vehicle(99, { x: .5, z: .5 }), snapshots = [...entries.map(e => e.car), obstruction];
  controller.update(0, snapshots); controller.request(entries[0].car.id, entries[0].movement, .2);
  controller.update(1, snapshots);
  for (const e of entries.slice(1)) controller.request(e.car.id, e.movement, .2);
  controller.update(.1, entries.map(e => e.car));
  for (const e of entries.slice(1)) assert.equal(controller.request(e.car.id, e.movement, .2).allowed, false);
  assert.equal(controller.request(entries[0].car.id, entries[0].movement, .2).allowed, true);
});

test('unlit bends use physical occupancy protection without waiting for a green light', () => {
  const network = roads([[-1, 0], [0, 0], [0, 1]]), controller = createTrafficController(network), junction = network.junctions[0];
  assert.equal(junction.signalized, false); assert.equal(controller.getDebug().junctionCount, 0);
  const [a, b] = junction.approaches, owner = approachVehicle(1, a), movement = movementFor(network, a);
  controller.update(0, [owner]); assert.equal(controller.request(owner.id, movement, owner.halfLength).allowed, true);
  const waiting = approachVehicle(2, b), opposite = movementFor(network, b);
  controller.update(10, [vehicle(owner.id, { x: .5, z: .5 }), waiting]);
  assert.equal(controller.request(waiting.id, opposite, waiting.halfLength).allowed, false);
  controller.cancel(owner.id); controller.update(0, [waiting]);
  assert.equal(controller.request(waiting.id, opposite, waiting.halfLength).allowed, true);
});

test('disappearing or explicitly cancelled vehicles release reservations and queued requests', () => {
  for (const cancel of [false, true]) {
    const network = roads(), controller = createTrafficController(network), movement = movementFor(network);
    const car = approachVehicle(1, network.junctions[0].approaches[0]);
    controller.update(0, [car]); assert.equal(controller.request(car.id, movement, car.halfLength).allowed, true);
    if (cancel) controller.cancel(car.id); else controller.update(0, []);
    assert.equal(controller.hasReservation(car.id), false); assert.equal(controller.getDebug().waiting, 0);
  }
});

test('demolishing an entrance invalidates its pending request and reservation without affecting a rebuilt crossing', () => {
  const network = roads(), controller = createTrafficController(network), a = network.junctions[0].approaches[0], movement = movementFor(network);
  const car = approachVehicle(1, a); controller.update(0, [car]); controller.request(car.id, movement, car.halfLength);
  const edited = roads(cross.filter(([x, z]) => x !== a.from.x || z !== a.from.z));
  controller.rebuild(edited); assert.equal(controller.hasReservation(car.id), false); assert.equal(controller.getDebug().waiting, 0);
  assert.deepEqual(controller.request(car.id, movement, car.halfLength), { allowed: false, reason: 'junction' });
  controller.rebuild(network); controller.update(0, [car]);
  assert.equal(controller.request(car.id, movement, car.halfLength).allowed, true);
});

test('demolishing the selected exit invalidates a reservation even when its entrance and junction survive', () => {
  const network = roads(), controller = createTrafficController(network), movement = movementFor(network), a = network.junctions[0].approaches[0];
  const car = approachVehicle(1, a); controller.update(0, [car]); assert.equal(controller.request(car.id, movement, car.halfLength).allowed, true);
  const edited = roads(cross.filter(([x, z]) => x !== movement.exit.x || z !== movement.exit.z));
  assert.equal(edited.junctions[0].id, network.junctions[0].id); assert.equal(edited.approaches.has(movement.approachId), true);
  controller.rebuild(edited); assert.equal(controller.hasReservation(car.id), false); assert.equal(controller.getDebug().waiting, 0);
  assert.deepEqual(controller.request(car.id, movement, car.halfLength), { allowed: false, reason: 'junction' });
});

test('service driveway admission reserves the street before the vehicle enters and releases after rear clearance',()=>{
  const network=roads(),controller=createTrafficController(network),j=network.junctions[0],a=j.approaches[0],traffic=approachVehicle(1,a),service=vehicle(2);
  controller.update(0,[traffic,service]);assert.equal(controller.reserveExternal(2,j.id),true);
  assert.deepEqual(controller.request(1,movementFor(network,a),.2),{allowed:false,reason:'junction'});
  controller.update(40,[traffic,{...service,x:.5,z:.5}]);assert.equal(controller.hasReservation(2),true);
  controller.update(0,[traffic,{...service,x:3,z:3}]);assert.equal(controller.hasReservation(2),false);
  controller.update(0,[traffic,{...service,x:.5,z:.5}]);assert.equal(controller.reserveExternal(1,j.id),false);
});

test('simultaneous unlit arrivals respect the configured side before either vehicle has queued',()=>{
  for(const side of ['right','left'] as const){
    const network=roads(),controller=createTrafficController(network,{signalsEnabled:false,prioritySide:side}),a=network.junctions[0].approaches[0];
    const b=network.junctions[0].approaches.find(b=>mustYieldToSide(a.direction,b.direction,side))!;
    const first=approachVehicle(1,a),preferred=approachVehicle(2,b);controller.update(0,[first,preferred]);
    assert.deepEqual(controller.request(1,movementFor(network,a),.2),{allowed:false,reason:'priority'});
    assert.deepEqual(controller.request(2,movementFor(network,b),.2),{allowed:true,reason:null});
  }
});

test('driveway reservations use the same free-exit-storage requirement as normal traffic',()=>{
  const network=roads(),controller=createTrafficController(network),m=movementFor(network),service=vehicle(2),blocker=afterExit(3,m,0);
  controller.update(0,[service,blocker]);assert.equal(controller.reserveExternal(2,m.junctionId,m),false);
  controller.update(0,[service]);assert.equal(controller.reserveExternal(2,m.junctionId,m),true);
});
