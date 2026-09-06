import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../src/simulation.ts';
import { createDrivingController, createVehicleMotion, drivingObstacle, drivingSurfaceHeight, getDrivingSpeedLimit, getVehicleDimensions, handBackToTraffic, setVehicleVelocity, stepVehicle, type DrivableCar, type DrivingHover, type DrivingInput, type VehicleMotion, type VehicleSweep, type VehicleCollision } from '../src/driving.ts';

function city() {
  const state = createCity(917, true, 40);
  for (const tile of state.tiles) { tile.kind = 'road'; tile.elevation = 0; tile.level = 0; tile.anchor = -1; }
  return state;
}

function car(state: ReturnType<typeof city>, x = 0, z = 0): DrivableCar {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(.18, .12, .32), new THREE.MeshStandardMaterial()));
  model.position.set(x, drivingSurfaceHeight(state, x, z), z);
  return { model, from: { x: 20, z: 20 }, to: { x: 20, z: 21 }, previous: { x: 20, z: 19 }, progress: .5, speed: .4 };
}

function run(state: ReturnType<typeof city>, motion: VehicleMotion, input: DrivingInput, seconds: number): void {
  for (let n = 0; n < seconds * 120; n++) stepVehicle(state, motion, input, 1 / 120);
}

test('throttle accelerates to a finite speed, coasting retains inertia, and handbrake stops without reversing', () => {
  const state = city(), motion = createVehicleMotion(state, 0, -8);
  run(state, motion, { throttle: 1, steer: 0, handbrake: false }, 3);
  assert.ok(motion.speed > 1.8 && motion.speed <= 70 / 36);
  const movingSpeed = motion.speed, position = motion.z;
  run(state, motion, { throttle: 0, steer: 0, handbrake: false }, .25);
  assert.ok(motion.speed > 0 && motion.speed < movingSpeed);
  assert.ok(motion.z > position);
  run(state, motion, { throttle: 0, steer: 0, handbrake: true }, 2);
  assert.equal(motion.speed, 0);
  const stoppedPosition = motion.z;
  run(state, motion, { throttle: 0, steer: 0, handbrake: true }, 1);
  assert.equal(motion.z, stoppedPosition);
});

test('brake first removes forward momentum; holding S then engages limited reverse', () => {
  const state = city(), motion = createVehicleMotion(state, 0, 0);
  run(state, motion, { throttle: 1, steer: 0, handbrake: false }, 1);
  run(state, motion, { throttle: -1, steer: 0, handbrake: false }, .2);
  assert.ok(motion.speed > 0);
  run(state, motion, { throttle: -1, steer: 0, handbrake: false }, 2);
  assert.ok(motion.speed < 0 && motion.speed >= -.68);
});

test('left steering bends motion left in the chase camera; reverse steering reverses yaw', () => {
  const state = city(), motion = createVehicleMotion(state, 0, 0);
  run(state, motion, { throttle: 1, steer: 1, handbrake: false }, 1);
  assert.ok(motion.x > .02 && motion.yaw > 0);
  const camera = new THREE.PerspectiveCamera(55, 1, .035, 160);
  camera.position.set(0, 1, -2); camera.lookAt(0, 0, 2); camera.updateMatrixWorld();
  const left = new THREE.Vector3(motion.x, 0, motion.z).project(camera);
  const straight = new THREE.Vector3(0, 0, motion.z).project(camera);
  assert.ok(left.x < straight.x, 'Positive yaw must project to the left from behind a +Z-forward car');
  const reverse = createVehicleMotion(state, 0, 0);
  run(state, reverse, { throttle: -1, steer: 1, handbrake: false }, 1);
  assert.ok(reverse.yaw < 0);
});

test('fixed-step input produces the same vehicle path at 30, 60 and 144 rendered frames per second', () => {
  const state = city();
  const simulate = (fps: number) => {
    const vehicle = car(state), system = createDrivingController(state, () => [vehicle]);
    system.enter(vehicle.model.id); system.keyDown('KeyW'); system.keyDown('KeyA');
    for (let frame = 0; frame < fps * 2; frame++) system.update(1 / fps);
    const result = [vehicle.model.position.x, vehicle.model.position.y, vehicle.model.position.z, vehicle.model.rotation.y, system.getStatus().speed];
    system.dispose(); return result;
  };
  const baseline = simulate(30);
  for (const fps of [60, 144]) simulate(fps).forEach((value, i) => assert.ok(Math.abs(value - baseline[i]) < 1e-9, `fps=${fps} component=${i}`));
});

test('a car enters the empty part of a facility lot and stops at its actual visible structure', () => {
  const state = city();
  for (let z = 21; z < 24; z++) for (let x = 19; x < 22; x++) {
    const tile = state.tiles[z * state.size + x]; tile.kind = 'hospital'; tile.level = 1; tile.anchor = 21 * state.size + 19;
  }
  const motion = createVehicleMotion(state, 0, -.5);
  run(state, motion, { throttle: 1, steer: 0, handbrake: false }, 6);
  assert.ok(motion.z > 1.2 && motion.z < 1.31, `Car must cross the empty lot border but stop at the hospital wall: z=${motion.z}`);
  assert.equal(motion.blocked, 'Gebäude im Weg');
  assert.equal(drivingObstacle(state, 0, 1.5, 0), 'Gebäude im Weg');
  const zoned = state.tiles[20 * state.size + 20]; zoned.kind = 'residential'; zoned.level = 0;
  assert.equal(drivingObstacle(state, .5, .5, 0), undefined);
  zoned.level = 1;
  assert.equal(drivingObstacle(state, .5, .5, 0), 'Gebäude im Weg');
});

test('cars cannot enter water or leave map bounds; road bridges remain driveable above the water', () => {
  const state = city();
  for (let x = 0; x < state.size; x++) { const tile = state.tiles[21 * state.size + x]; tile.kind = 'water'; tile.elevation = -1; }
  const motion = createVehicleMotion(state, 0, -.5);
  run(state, motion, { throttle: 1, steer: 0, handbrake: false }, 6);
  assert.ok(motion.z + .3385 / 2 < 1); assert.equal(motion.blocked, 'Hier ist Wasser');
  for (const tile of state.tiles) { tile.kind = 'road'; tile.elevation = -1; }
  assert.equal(drivingObstacle(state, 0, 0, 0), undefined);
  assert.ok(drivingSurfaceHeight(state, 0, 0) > 0, 'Bridge cars stay above sea level');
  const edge = createVehicleMotion(state, 0, 19.5);
  run(state, edge, { throttle: 1, steer: 0, handbrake: false }, 4);
  assert.ok(edge.z + .3385 / 2 < 20); assert.equal(edge.blocked, 'Stadtrand erreicht');
});

test('road hills lift the vehicle and tilt its suspension without nonfinite transforms or sinking', () => {
  const state = city();
  for (const tile of state.tiles) tile.elevation = Math.max(0, Math.min(8, (tile.z - 17) * .5));
  const motion = createVehicleMotion(state, 0, -1);
  const initialHeight = motion.y;
  run(state, motion, { throttle: 1, steer: 0, handbrake: false }, 2);
  assert.ok(motion.y > initialHeight + .15);
  assert.ok(motion.pitch < -.1);
  assert.ok(motion.y >= drivingSurfaceHeight(state, motion.x, motion.z) - .026);
  for (const value of [motion.x, motion.y, motion.z, motion.pitch, motion.roll, motion.yaw]) assert.ok(Number.isFinite(value));
});

test('ordinary asphalt curbs allow driving onto grass and back, while off-road speed stays limited', () => {
  const state = city();
  for (const tile of state.tiles) if (tile.z >= 20) tile.kind = 'empty';
  const motion = createVehicleMotion(state, 0, -.5);
  run(state, motion, { throttle: 1, steer: 0, handbrake: false }, 3);
  assert.ok(motion.z > .5, 'The road pavement thickness must not be mistaken for a cliff');
  assert.ok(motion.speed <= 25 / 36 + 1e-6);
  setVehicleVelocity(motion, 0, 0);
  run(state, motion, { throttle: -1, steer: 0, handbrake: false }, 7);
  assert.ok(motion.z < -.2, 'The same curb must be passable in the uphill direction');
  assert.notEqual(motion.blocked, 'Hang zu steil');
});

test('hover selects and glows one car, respects occlusion distance, and survives moving to its steering icon', () => {
  const state = city(), vehicle = car(state), hovers: (DrivingHover | null)[] = [];
  const system = createDrivingController(state, () => [vehicle], { onHover: info => hovers.push(info) });
  const view = new THREE.PerspectiveCamera(55, 2, .1, 160);
  view.position.set(0, 3, -3); view.lookAt(0, 0, 0); view.updateMatrixWorld();
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
  const bounds = { left: 100, top: 40, width: 1200, height: 600 };
  const hover = system.hover(raycaster, view, bounds);
  assert.equal(hover?.id, vehicle.model.id); assert.ok(Number.isFinite(hover?.screenX));
  system.update(.016); assert.equal(system.group.visible, true);
  assert.equal(system.group.userData.raytracingExclude, true);
  raycaster.ray.origin.x = 10;
  assert.equal(system.hover(raycaster, view, bounds)?.id, vehicle.model.id);
  system.update(.25); assert.equal(system.group.visible, true);
  assert.equal(system.enter(vehicle.model.id), true); assert.equal(system.group.visible, false);
  assert.equal(hovers.at(-1), null); system.exit();
  raycaster.ray.origin.copy(vehicle.model.position); raycaster.ray.origin.y += 5;
  raycaster.far = 2;
  assert.equal(system.hover(raycaster, view, bounds), null, 'A nearer terrain/building hit must occlude the car');
  system.dispose();
});

test('entering a vehicle flies toward a finite perspective chase camera and controls stay independent of city pause', () => {
  const state = city(), vehicle = car(state), system = createDrivingController(state, () => [vehicle]);
  state.speed = 0;
  const view = new THREE.PerspectiveCamera(55, 2, .1, 160);
  view.position.set(20, 30, -20); view.lookAt(vehicle.model.position); view.updateMatrixWorld();
  system.hover(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)), view, { left: 0, top: 0, width: 1200, height: 600 });
  assert.equal(system.enter(vehicle.model.id), true); system.resize(1200, 600);
  assert.equal(system.camera.aspect, 2); assert.ok(system.camera.position.distanceTo(vehicle.model.position) > 20);
  assert.equal(system.keyDown('KeyW'), true); assert.equal(system.keyDown('KeyQ'), false);
  for (let i = 0; i < 180; i++) system.update(1 / 120);
  assert.ok(system.camera.position.distanceTo(vehicle.model.position) < 4);
  assert.ok(vehicle.model.position.z > .1); assert.equal(system.active, true);
  assert.ok(system.getStatus().speed > 0);
  for (const value of system.camera.matrixWorld.elements) assert.ok(Number.isFinite(value));
  assert.equal(system.keyDown('Escape'), true); assert.equal(system.active, false);
  assert.equal(system.keyDown('KeyW'), false); system.dispose();
});

test('hover expires after leaving the canvas or after the autonomous car leaves a stationary pointer', () => {
  const state = city(), vehicle = car(state), hovers: (DrivingHover | null)[] = [];
  const system = createDrivingController(state, () => [vehicle], { onHover: info => hovers.push(info) });
  const camera = new THREE.PerspectiveCamera(55, 1, .1, 160);
  camera.position.set(0, 3, -3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
  const viewport = { left: 0, top: 0, width: 800, height: 800 };
  system.hover(ray, camera, viewport); system.leaveHover();
  system.update(.25); assert.equal(system.group.visible, true, 'Allow enough time to reach the wheel button');
  for (let i = 0; i < 4; i++) system.update(.25);
  assert.equal(system.group.visible, false); assert.equal(hovers.at(-1), null);
  system.hover(ray, camera, viewport); vehicle.model.position.x = 1;
  for (let i = 0; i < 4; i++) system.update(.25);
  assert.equal(system.group.visible, false); assert.equal(hovers.at(-1), null);
  system.dispose();
});

test('traffic handback refuses a distant road and only synchronizes a car already on its lane', () => {
  const state = city(), vehicle = car(state);
  for (const tile of state.tiles) tile.kind = 'empty';
  for (let z = 18; z <= 24; z++) state.tiles[z * state.size + 18].kind = 'road';
  vehicle.model.position.set(2, .01, 1.8); vehicle.model.rotation.y = 0;
  const original = vehicle.model.position.clone();
  assert.equal(handBackToTraffic(state, vehicle), false); assert.deepEqual(vehicle.model.position, original);
  vehicle.model.position.set(-1.63, drivingSurfaceHeight(state, -1.63, 1.8), 1.8);
  assert.equal(handBackToTraffic(state, vehicle), true);
  assert.equal(vehicle.from.x, 18); assert.equal(vehicle.to.x, 18);
  assert.ok(vehicle.progress >= 0 && vehicle.progress < 1);
  assert.equal(state.tiles[vehicle.from.z * state.size + vehicle.from.x].kind, 'road');
  assert.equal(state.tiles[vehicle.to.z * state.size + vehicle.to.x].kind, 'road');
  assert.ok(Math.abs(vehicle.from.z - vehicle.to.z) === 1);
  assert.equal(drivingObstacle(state, vehicle.model.position.x, vehicle.model.position.z, vehicle.model.rotation.y), undefined);
});

test('replacing the traffic list safely releases a stale selected car and clears held keys', () => {
  const state = city(), vehicle = car(state); let traffic = [vehicle];
  const system = createDrivingController(state, () => traffic);
  system.enter(vehicle.model.id); system.keyDown('KeyW'); traffic = [];
  system.update(.016);
  assert.equal(system.selectedCar, null); assert.equal(system.getStatus().active, false);
  assert.equal(system.enter(vehicle.model.id), false); system.dispose(); system.dispose();
});

test('the speed governor uses 50 km/h by developed streets, 70 outside town, and 25 off road', () => {
  const state = city();
  assert.equal(getDrivingSpeedLimit(state, 0, 0), 70);
  for (let z = 0; z < state.size; z++) Object.assign(state.tiles[z * state.size + 23], { kind: 'residential', level: 1 });
  assert.equal(getDrivingSpeedLimit(state, 0, 0), 50);
  assert.equal(getDrivingSpeedLimit(state, -8, 0), 70);
  state.tiles[20 * state.size + 18].kind = 'empty';
  assert.equal(getDrivingSpeedLimit(state, -1.5, .5), 25);
  const motion = createVehicleMotion(state, 0, -2);
  run(state, motion, { throttle: 1, steer: 0, handbrake: false }, 4);
  assert.ok(motion.speed > 1.2 && motion.speed <= 50 / 36 + 1e-7);
});

test('handbrake plus steering retains world momentum as a real sideways slide, and tire grip recovers on release', () => {
  const state = city(), normal = createVehicleMotion(state, 5, 5), drift = createVehicleMotion(state, 5, 5);
  for (const motion of [normal, drift]) setVehicleVelocity(motion, 0, 50 / 36);
  run(state, normal, { throttle: 0, steer: 1, handbrake: false }, .5);
  run(state, drift, { throttle: 0, steer: 1, handbrake: true }, .5);
  assert.ok(Math.abs(drift.lateralSpeed) > Math.abs(normal.lateralSpeed) * 2.5);
  assert.ok(Math.hypot(drift.vx, drift.vz) > .7, 'A steering handbrake should not simply stop the car');
  assert.ok(drift.yaw > .35 && Math.abs(Math.atan2(drift.vx, drift.vz) - drift.yaw) > .35);
  assert.ok(drift.x < normal.x * .1 + 4.5, 'The mass should continue along its old path while the body turns');
  assert.equal(drift.drifting, true);
  run(state, drift, { throttle: 0, steer: 0, handbrake: false }, .5);
  assert.ok(Math.abs(drift.lateralSpeed) < .04);
  assert.equal(drift.drifting, false);
});

test('ramming a stopped traffic car transfers momentum and keeps the two bodies from passing through each other', () => {
  const state = city(), player = car(state, 0, -1), parked = car(state, 0, 0), hits: VehicleCollision[] = [];
  parked.speed = 0;
  const system = createDrivingController(state, () => [player, parked], { onCollision: hit => hits.push(hit) });
  system.enter(player.model.id); system.keyDown('KeyW');
  for (let frame = 0; frame < 240; frame++) system.update(1 / 120);
  assert.ok(parked.model.position.z > .5, 'The other car must visibly move from the impact');
  assert.ok(parked.model.position.z - player.model.position.z >= .3385 - .0001);
  assert.equal(system.controlsCar(parked), true, 'Traffic must not overwrite the knocked vehicle on the next frame');
  assert.ok(hits.length >= 1 && hits[0].speed > .7);
  assert.equal(hits[0].otherId, parked.model.id); assert.ok(system.getStatus().collisionCount! >= 1);
  system.dispose();
});

test('a glancing vehicle collision produces a sideways deflection and yaw instead of a full head-on stop', () => {
  const state = city(), player = car(state, 0, -1), target = car(state, .145, 0), hits: VehicleCollision[] = [];
  target.speed = 0;
  const system = createDrivingController(state, () => [player, target], { onCollision: hit => hits.push(hit) });
  system.enter(player.model.id); system.keyDown('KeyW');
  for (let frame = 0; frame < 170; frame++) system.update(1 / 120);
  assert.ok(hits.length > 0);
  assert.ok(Math.abs(target.model.position.x - .145) > .005 || Math.abs(player.model.position.x) > .005);
  assert.ok(Math.abs(target.model.rotation.y) > .03 || Math.abs(player.model.rotation.y) > .03);
  for (const vehicle of [player, target]) for (const value of [...vehicle.model.position.toArray(), ...vehicle.model.quaternion.toArray()]) assert.ok(Number.isFinite(value));
  system.dispose();
});

test('overlapping stationary cars separate even without throttle and a fast crossing NPC is swept between frames', () => {
  const state = city(), player = car(state), neighbor = car(state, .05, 0);
  player.speed = neighbor.speed = 0;
  const system = createDrivingController(state, () => [player, neighbor]);
  system.enter(player.model.id); system.update(1 / 120);
  assert.ok(Math.abs(player.model.position.x - neighbor.model.position.x) >= .183 - .00001);
  system.dispose();

  const a = car(state, 5, 0), crossing = car(state, 5, -2), collisions: VehicleCollision[] = [];
  a.speed = 0; crossing.speed = 3;
  const fast = createDrivingController(state, () => [a, crossing], { onCollision: hit => collisions.push(hit) });
  fast.enter(a.model.id); fast.update(1 / 120);
  crossing.model.position.z = 2;
  fast.update(.05);
  assert.ok(collisions.length > 0, 'A vehicle traversing both sides between frames must still hit');
  assert.equal(fast.controlsCar(crossing), true);
  assert.ok(crossing.model.position.z < 1, 'The swept contact must resolve near the impact instead of tunneling past');
  fast.dispose();
});

test('pedestrian sweeps contain each physical step, real world velocity, and the selected variant dimensions', () => {
  const state = city(), truck = car(state), sweeps: VehicleSweep[] = [];
  truck.model.userData.vehicleDimensions = { width: .237, length: .5745, height: .259, wheelBase: .3365, mass: 2.5 };
  const system = createDrivingController(state, () => [truck], { onVehicleSweep: sweep => sweeps.push(sweep) });
  system.enter(truck.model.id); system.keyDown('KeyW'); system.update(.25);
  assert.equal(sweeps.length, 30);
  assert.equal(getVehicleDimensions(truck.model).mass, 2.5);
  for (const sweep of sweeps) {
    assert.equal(sweep.vehicleId, truck.model.id);
    assert.equal(sweep.width, .237); assert.equal(sweep.length, .5745); assert.equal(sweep.height, .259);
    assert.ok(sweep.current.z >= sweep.previous.z);
    assert.ok(Math.abs((sweep.current.z - sweep.previous.z) * 120 - sweep.velocity.z) < 1e-8);
    assert.ok(Number.isFinite(sweep.velocity.y));
  }
  system.dispose();
});

test('the front of a longer truck remains hoverable and its glow uses the actual variant dimensions', () => {
  const state = city(), truck = car(state);
  truck.model.userData.vehicleDimensions = { width: .237, length: .5745, height: .259, wheelBase: .3365, mass: 2.5 };
  const system = createDrivingController(state, () => [truck]);
  const view = new THREE.PerspectiveCamera(55, 1, .1, 160);
  view.position.set(0, 3, -3); view.lookAt(0, 0, 0); view.updateMatrixWorld();
  const hover = system.hover(new THREE.Raycaster(new THREE.Vector3(0, 5, .26), new THREE.Vector3(0, -1, 0)), view, { left: 0, top: 0, width: 800, height: 800 });
  assert.equal(hover?.id, truck.model.id);
  system.update(1 / 120);
  assert.equal(system.group.visible, true);
  const outline = system.group.children.find(child => child instanceof THREE.LineSegments)!;
  assert.ok(outline.scale.z > 1.6);
  system.dispose();
});

test('exiting off the street keeps the exact car pose and state replacement releases all physical recoveries', () => {
  const state = city();
  for (const tile of state.tiles) tile.kind = 'empty';
  for (let z = 0; z < state.size; z++) state.tiles[z * state.size + 18].kind = 'road';
  const vehicle = car(state, 2, 1.8), system = createDrivingController(state, () => [vehicle]);
  system.enter(vehicle.model.id); system.keyDown('KeyW'); system.update(.1);
  const beforeExit = vehicle.model.position.clone();
  system.exit();
  assert.deepEqual(vehicle.model.position, beforeExit);
  assert.equal(system.active, false); assert.equal(system.controlsCar(vehicle), true);
  system.update(.2);
  assert.ok(vehicle.model.position.distanceTo(beforeExit) < .2, 'Exit recovery must not jump to the distant street');
  system.setState(city());
  assert.equal(system.controlsCar(vehicle), false); assert.equal(system.getStatus().active, false);
  system.dispose();
});

test('taking over waiting traffic starts stationary and rear-end impulses do not invent a waiting car velocity', () => {
  const state = city(), waiting = car(state);
  waiting.speed = .65; waiting.model.userData.trafficWaiting = true;
  const takeover = createDrivingController(state, () => [waiting]);
  takeover.enter(waiting.model.id);
  const position = waiting.model.position.clone();
  assert.equal(takeover.getStatus().speed, 0);
  takeover.update(.25); assert.deepEqual(waiting.model.position, position);
  takeover.dispose();

  const player = car(state, 0, -1), stopped = car(state), hits: VehicleCollision[] = [];
  stopped.speed = .65; stopped.model.userData.trafficWaiting = true;
  const collision = createDrivingController(state, () => [player, stopped], { onCollision: hit => hits.push(hit) });
  collision.enter(player.model.id); collision.keyDown('KeyW');
  for (let frame = 0; frame < 130; frame++) collision.update(1 / 120);
  assert.ok(hits[0]?.speed > 1, 'The waiting car has no forward velocity to subtract from the rear impact');
  collision.dispose();
});

test('hitting an actual building emits one world crash with pre-impact speed and a surface contact point', () => {
  const state = city(), vehicle = car(state, .5, -1), hits: VehicleCollision[] = [];
  for (let x = 0; x < state.size; x++) Object.assign(state.tiles[22 * state.size + x], { kind: 'residential', level: 1, variation: 0 });
  const system = createDrivingController(state, () => [vehicle], { onCollision: hit => hits.push(hit) });
  system.enter(vehicle.model.id); system.keyDown('KeyW');
  for (let frame = 0; frame < 720; frame++) system.update(1 / 120);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].otherId, null); assert.equal(hits[0].vehicleId, vehicle.model.id);
  assert.ok(hits[0].speed > .6); assert.ok(hits[0].normal.z > .9);
  assert.ok(hits[0].point.z > vehicle.model.position.z);
  assert.equal(system.getStatus().collisionCount, 1); assert.equal(system.getStatus().blocked, 'Gebäude im Weg');
  system.dispose();
});
