import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCity } from '../src/simulation.ts';
import { getModelFootprint } from '../src/models.ts';
import { getRoadStreetlightFixture } from '../src/streetlights.ts';
import { createDrivingCollisionWorld, extractDrivingCollisionShapes, collisionShapeIntersects } from '../src/driving-collisions.ts';
import type { CityState, TileKind } from '../src/types.ts';

function city() {
  const state = createCity(917, true, 40);
  for (const tile of state.tiles) { tile.kind = 'empty'; tile.elevation = 0; tile.level = 0; tile.anchor = -1; tile.hasPipe = tile.hasPowerLine = false; }
  return state;
}

function facility(state: CityState, kind: TileKind, rotation: 0 | 1 | 2 | 3 = 0, elevation = 0) {
  const x = 15, z = 15, anchor = z * state.size + x;
  const [width, depth] = getModelFootprint(kind, rotation);
  for (let tz = z; tz < z + depth; tz++) for (let tx = x; tx < x + width; tx++) {
    Object.assign(state.tiles[tz * state.size + tx], { kind, level: 1, anchor, rotation, elevation });
  }
  state.revision++;
  const centerX = x - state.size / 2 + width / 2, centerZ = z - state.size / 2 + depth / 2;
  const angle = -rotation * Math.PI / 2;
  return (x: number, z: number): [number, number] => [centerX + Math.cos(angle) * x + Math.sin(angle) * z, centerZ - Math.sin(angle) * x + Math.cos(angle) * z];
}

test('stadium playing surface and running track stay open; stands and goalposts block in all rotations', () => {
  for (const rotation of [0, 1, 2, 3] as const) {
    const state = city(), point = facility(state, 'stadium', rotation), world = createDrivingCollisionWorld(state);
    assert.equal(world.collides(...point(.4, .4), 0), undefined, `Pitch rotation ${rotation}`);
    assert.equal(world.collides(...point(0, .9), 0), undefined, `Pitch near line rotation ${rotation}`);
    assert.equal(world.collides(...point(0, 1.38), 0), 'Gebäude im Weg');
    assert.equal(world.pointBlocked(...point(1.91, .31)), true, 'Thin goalpost must collide');
    assert.ok(world.surfaceHeight(...point(.4, .4), 0) >= .147, 'Visible turf supports the car');
    assert.equal(world.pointBlocked(...point(1.2, 2.2)), false, 'Can pass below roof between the support pillars');
    world.dispose();
  }
});

test('airport runway, apron and empty parking space remain driveable; terminal and parked vehicles block', () => {
  const state = city(), point = facility(state, 'airport'), world = createDrivingCollisionWorld(state);
  assert.equal(world.collides(...point(0, -1.6), 0), undefined);
  assert.equal(world.collides(...point(-.9, .35), 0), undefined, 'Unoccupied aircraft apron beside the jetway');
  const emptySpace = -.68 - 14 * .27 / 2 + 1.5 * .27;
  assert.equal(world.collides(...point(emptySpace, 2.56), 0), undefined, 'Empty marked parking bay with room behind the terminal');
  assert.equal(world.pointBlocked(...point(-.71, 1.77)), true, 'Inside the terminal');
  const parkedSpace = -.68 - 14 * .27 / 2 + .5 * .27;
  assert.equal(world.pointBlocked(...point(parkedSpace, 2.5)), true, 'Actual parked car remains solid');
  assert.ok(world.surfaceHeight(...point(0, -1.6), 0) >= .108, 'Runway elevation supports wheels');
});

test('building walls have exact setbacks and allow factory service passages', () => {
  const state = city(), tile = state.tiles[20 * state.size + 20];
  Object.assign(tile, { kind: 'industrial', level: 1, variation: 0 });
  const world = createDrivingCollisionWorld(state);
  assert.equal(world.pointBlocked(.5 - .09, .5 + .07), true);
  assert.equal(world.pointBlocked(.5 + .31, .5 - .23), true, 'Narrow chimney blocks at its actual location');
  assert.equal(world.collides(.5 - .2, .5 - .4, Math.PI / 2), undefined, 'Pass the low curb behind the factory');
  assert.equal(world.pointBlocked(.5 + .46, .5 - .42), false, 'Tile occupancy does not fill vacant corners');
});

test('geometry cache follows growth, demolition, terraforming and state replacement', () => {
  const state = city(), tile = state.tiles[20 * state.size + 20], world = createDrivingCollisionWorld(state);
  Object.assign(tile, { kind: 'residential', level: 0, variation: 1 });
  assert.equal(world.pointBlocked(.46, .45), false);
  tile.level = 1;
  assert.equal(world.pointBlocked(.46, .45), true, 'Even in-place changes invalidate the relevant geometry');
  tile.elevation = 3; state.revision++;
  assert.equal(world.pointBlocked(.46, .45, 0), false, 'Elevated walls are not ground-level obstacles');
  assert.equal(world.pointBlocked(.46, .45, 3), true);
  tile.kind = 'empty'; tile.level = 0;
  assert.equal(world.pointBlocked(.46, .45), false);
  world.setState(city());
  assert.equal(world.pointBlocked(.46, .45), false);
  world.dispose();
});

test('elevated facility foundations use world height and follower tiles resolve their anchor', () => {
  const state = city(), point = facility(state, 'airport', 1, 4), world = createDrivingCollisionWorld(state);
  assert.equal(world.pointBlocked(...point(-.71, 1.77), 4), true);
  assert.equal(world.pointBlocked(...point(-.71, 1.77), 0), false);
  assert.equal(world.collides(...point(0, -1.6), 0, undefined, 4.108), undefined);
  assert.ok(Math.abs(world.surfaceHeight(...point(0, -1.6), 4) - 4.12) < .015);
});

function meshBox(x: number, y: number, z: number, width: number, height: number, depth: number, yaw = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth));
  mesh.position.set(x, y, z); mesh.rotation.y = yaw; return mesh;
}

test('oriented car and wall SAT permits the empty corners of rotated obstacle bounds', () => {
  const root = new THREE.Group(); root.add(meshBox(0, .4, 0, .12, .8, 2, Math.PI / 4));
  const [shape] = extractDrivingCollisionShapes(root);
  assert.equal(collisionShapeIntersects(shape, .5, -.5, Math.PI / 4), false, 'Inside AABB but away from rotated wall');
  assert.equal(collisionShapeIntersects(shape, .5, .5, Math.PI / 4), true);
  assert.equal(collisionShapeIntersects(shape, .2, -.2, Math.PI / 4), false);
});

test('a merged geometry with separate pillars never fills the space between them', () => {
  const left = new THREE.BoxGeometry(.12, 1, .12).translate(-.6, .5, 0);
  const right = new THREE.BoxGeometry(.12, 1, .12).translate(.6, .5, 0);
  const root = new THREE.Mesh(mergeGeometries([left, right]));
  const shapes = extractDrivingCollisionShapes(root);
  assert.equal(shapes.length, 2);
  assert.equal(shapes.some(shape => collisionShapeIntersects(shape, 0, 0, 0)), false);
  assert.equal(shapes.some(shape => collisionShapeIntersects(shape, .6, 0, 0)), true);
});

test('a car passes below overhead shapes and does not collide with broad high tree crowns', () => {
  const root = new THREE.Group();
  root.add(meshBox(0, .5, 0, 2, .2, 2));
  const crown = new THREE.Mesh(new THREE.SphereGeometry(.6, 12, 8)); crown.position.y = 1.1; root.add(crown);
  assert.equal(extractDrivingCollisionShapes(root).some(shape => collisionShapeIntersects(shape, .3, 0, 0)), false);
  root.add(meshBox(0, .5, 0, .025, 1, .025));
  assert.equal(extractDrivingCollisionShapes(root).some(shape => collisionShapeIntersects(shape, 0, 0, 0)), true, 'Support pole remains a real obstacle');
});

test('inclined geometry uses the slice at car height, not its aggregate projected bounds', () => {
  const root = new THREE.Group(), beam = meshBox(0, .7, 0, .08, 1.7, .08);
  beam.rotation.z = -Math.PI / 4; root.add(beam);
  const [shape] = extractDrivingCollisionShapes(root);
  assert.equal(collisionShapeIntersects(shape, .45, 0, 0), false, 'Upper tilted beam is above the vehicle');
  assert.equal(collisionShapeIntersects(shape, -.5, 0, 0), true, 'Low end of the same beam blocks');
});

test('forest trunk collisions match the rendered instancing transforms', () => {
  const state = city(), tile = state.tiles[20 * state.size + 20]; Object.assign(tile, { kind: 'tree', variation: 17 });
  const noise = (x: number, z: number) => { const n = Math.sin(x * 127.1 + z * 311.7 + state.seed * 17.77) * 43758.5453; return n - Math.floor(n); };
  const angle = noise(tile.x, tile.z) * Math.PI * 2, scale = .8 + noise(tile.z, tile.x) * .38;
  const x = .5 + (-.12 * Math.cos(angle) - .09 * Math.sin(angle)) * scale;
  const z = .5 + (.12 * Math.sin(angle) - .09 * Math.cos(angle)) * scale;
  const world = createDrivingCollisionWorld(state);
  assert.equal(world.pointBlocked(x, z), true);
  assert.equal(world.pointBlocked(.04, .04), false);
});

test('street lamps stay solid while the surrounding asphalt remains driveable', () => {
  const state = city(); Object.assign(state.tiles[21 * state.size + 21], { kind: 'road' });
  const world = createDrivingCollisionWorld(state);
  const fixture = getRoadStreetlightFixture(state, state.tiles[21 * state.size + 21])!;
  assert.equal(world.pointBlocked(fixture.mast.x, fixture.mast.z, .057), true);
  assert.equal(world.pointBlocked(fixture.mast.x + .023, fixture.mast.z, .057), false, 'Low wide footing does not inflate the pole at body height');
  assert.equal(world.collides(1.5, 1.5, 0, undefined, .057), undefined);
});

test('a road lamp follows its interpolated deck even far below the stored tile elevation', () => {
  const state = city();
  for (let z = 20; z <= 22; z++) for (let x = 20; x <= 22; x++) state.tiles[z * state.size + x].kind = 'road';
  const tile = state.tiles[21 * state.size + 21]; tile.elevation = 4;
  const fixture = getRoadStreetlightFixture(state, tile)!, world = createDrivingCollisionWorld(state);
  assert.ok(fixture.mast.y < tile.elevation - 1);
  assert.equal(world.pointBlocked(fixture.mast.x, fixture.mast.z, fixture.mast.y + .012), true);
});

test('low thin parts of explicit props remain solid instead of becoming pavement', () => {
  const aircraft = new THREE.Group(); aircraft.userData.drivingObstacle = true;
  aircraft.add(meshBox(0, .17, 0, 1, .025, .25));
  const [wing] = extractDrivingCollisionShapes(aircraft);
  assert.equal(wing.surface, false);
  assert.equal(collisionShapeIntersects(wing, 0, 0, 0, undefined, .108), true);
});

test('parked airplane wings block the body and never lift the car as paving', () => {
  const state = city(), point = facility(state, 'airport'), world = createDrivingCollisionWorld(state);
  const [x, z] = point(-2.39, .2981);
  assert.ok(world.surfaceHeight(x, z, 0) < .12, 'Only the concrete apron supports wheels');
  assert.equal(world.pointBlocked(x, z, .108), true, 'The wing is a solid obstacle');
});

test('flat stadium paint does not acquire a solid convex interior', () => {
  const marking = new THREE.Mesh(new THREE.RingGeometry(.36, .379, 24));
  marking.rotation.x = -Math.PI / 2; marking.position.y = .169;
  assert.equal(extractDrivingCollisionShapes(marking).length, 0);
});
