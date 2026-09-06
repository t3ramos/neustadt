import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { createCar } from '../../src/rendering/buildings/models.ts';
import {
  CitizenRagdoll,
  createCitizenPhysicsWorld,
  createCitizens,
  createBuildingCollider,
  createGroundCollider,
  citizenSurfaceHeight,
  IMPACT_THRESHOLD,
  isGentleRelease,
  isCitizenIncidentWitnessed,
  MAX_CITIZENS,
  CITIZEN_SCALE,
  CITIZEN_PICK_RADIUS,
  MAX_HAND_SPEED,
} from '../../src/citizens/system.ts';
import type { CitizenIncident } from '../../src/domain/types.ts';

function floor(world: CANNON.World, y = 0): CANNON.Body {
  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(10, 1, 10)),
    position: new CANNON.Vec3(0, y - 1, 0),
    collisionFilterGroup: 1,
    collisionFilterMask: 2,
  });
  world.addBody(body);
  return body;
}
function step(world: CANNON.World, seconds: number): void {
  for (let i = 0; i < seconds * 120; i++) world.step(1 / 120);
}
function city() {
  const state = createCity(91, true, 40);
  for (const t of state.tiles) {
    t.kind = 'empty';
    t.elevation = 1;
    t.anchor = -1;
    t.level = 0;
  }
  for (let x = 5; x < 20; x++) {
    state.tiles[10 * 40 + x].kind = 'road';
    state.tiles[11 * 40 + x].kind = 'residential';
    state.tiles[11 * 40 + x].level = 2;
  }
  state.stats.population = 1500;
  state.revision++;
  return state;
}

test('a citizen is six independent mass bodies with five angularly limited physical joints', () => {
  const world = createCitizenPhysicsWorld(),
    doll = new CitizenRagdoll(world, { x: 0, y: 0, z: 0 });
  assert.equal(Object.values(doll.bodies).length, 6);
  assert.equal(world.bodies.length, 6);
  assert.equal(doll.constraints.length, 5);
  for (const joint of doll.constraints) {
    assert.ok(joint instanceof CANNON.ConeTwistConstraint);
    assert.ok(joint.angle > 0 && joint.angle < Math.PI);
    assert.ok(joint.twistAngle > 0 && joint.twistAngle < Math.PI);
    assert.equal(joint.collideConnected, false);
  }
  for (const body of Object.values(doll.bodies)) assert.ok(body.mass > 0);
  doll.dispose();
  assert.equal(world.bodies.length, 0);
  assert.equal(world.constraints.length, 0);
});

test('all miniature adults stay below .18 units including hats, fit the car scale, and have matching physics', () => {
  const system = createCitizens(city()),
    meshes = system.group.children.filter(
      (o): o is THREE.InstancedMesh =>
        o instanceof THREE.InstancedMesh && o.name.startsWith('citizen-'),
    );
  const matrix = new THREE.Matrix4(),
    scale = new THREE.Vector3(),
    position = new THREE.Vector3(),
    quaternion = new THREE.Quaternion();
  const carSize = new THREE.Box3().setFromObject(createCar(0x718394)).getSize(new THREE.Vector3()),
    carLength = Math.max(carSize.x, carSize.z);
  for (let i = 0; i < system.getDebug().count; i++) {
    const bounds = new THREE.Box3();
    let headWidth = 0,
      shoulderWidth = 0;
    for (const mesh of meshes) {
      mesh.getMatrixAt(i, matrix);
      mesh.geometry.computeBoundingBox();
      bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));
      matrix.decompose(position, quaternion, scale);
      if (mesh.name === 'citizen-head') headWidth = scale.x;
      if (mesh.name === 'citizen-torso') shoulderWidth = scale.x;
    }
    const height = bounds.max.y - bounds.min.y;
    assert.ok(height >= 0.15 && height <= 0.18, `Actor ${i} is ${height} units tall`);
    assert.ok(
      height < carLength * 0.6 && height > carLength * 0.4,
      `Adult height ${height} should be proportionate to car length ${carLength}`,
    );
    assert.ok(
      headWidth / shoulderWidth < 0.75,
      'Adult heads must be narrower than the shoulders, not oversized bobbleheads',
    );
  }
  const doll = new CitizenRagdoll(createCitizenPhysicsWorld(), { x: 0, y: 0, z: 0 });
  const physicalHeight =
    doll.bodies.head.position.y + (doll.bodies.head.shapes[0] as CANNON.Sphere).radius;
  assert.ok(
    physicalHeight > 0.15 && physicalHeight < 0.18,
    'Ragdoll collision geometry must shrink with the rendered person',
  );
  assert.ok((doll.bodies.torso.shapes[0] as CANNON.Box).halfExtents.x * 2 < 0.06);
  assert.ok(
    CITIZEN_PICK_RADIUS >= 0.16 && CITIZEN_PICK_RADIUS <= 0.2,
    'Small actors must remain comfortable to pick',
  );
  system.dispose();
  doll.dispose();
});

test('rounded resident details preserve instancing and a bounded triangle budget', () => {
  const system = createCitizens(city()),
    meshes = system.group.children.filter(
      (o): o is THREE.InstancedMesh =>
        o instanceof THREE.InstancedMesh && o.name.startsWith('citizen-'),
    );
  assert.equal(
    meshes.length,
    27,
    'Face, clothing and hair details stay in shared instance batches',
  );
  const triangles = meshes.reduce(
    (sum, mesh) =>
      sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
    0,
  );
  assert.ok(
    triangles <= 4300,
    `Resident detail exceeded its shared geometry budget: ${triangles} triangles`,
  );
  for (const name of ['head', 'hair', 'leftArm', 'leftShoe', 'leftHand', 'backpack']) {
    const mesh = system.group.getObjectByName(`citizen-${name}`) as THREE.InstancedMesh,
      normal = mesh.geometry.getAttribute('normal');
    let curved = false;
    for (let i = 0; i < normal.count; i++)
      if (
        [normal.getX(i), normal.getY(i), normal.getZ(i)].some(
          (n) => Math.abs(n) > 0.05 && Math.abs(n) < 0.95,
        )
      ) {
        curved = true;
        break;
      }
    assert.ok(curved, `${name} should have genuinely rounded geometry rather than flat cube faces`);
  }
  system.dispose();
});

test('lifted articulated bodies follow the physical hand and remain finite across 720 solver steps', () => {
  const world = createCitizenPhysicsWorld();
  floor(world);
  const doll = new CitizenRagdoll(world, { x: 0, y: 0.02, z: 0 });
  doll.hold({ x: 0, y: 0.02 + 0.32 * CITIZEN_SCALE, z: 0 });
  for (let i = 0; i < 720; i++) {
    doll.move({ x: Math.sin(i * 0.02) * 0.4, y: 0.8 + Math.sin(i * 0.007) * 0.35, z: 0 });
    world.step(1 / 120);
  }
  assert.ok(doll.position.y > 0.3);
  for (const body of Object.values(doll.bodies))
    for (const value of [
      body.position.x,
      body.position.y,
      body.position.z,
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
    ])
      assert.ok(Number.isFinite(value));
  for (const joint of doll.constraints) {
    const a = joint.bodyA.pointToWorldFrame(joint.pivotA),
      b = joint.bodyB.pointToWorldFrame(joint.pivotB);
    assert.ok(a.distanceTo(b) < 0.09, `Joint separated by ${a.distanceTo(b)}`);
  }
  doll.dispose();
});

test('an extreme pointer jump cannot pull joints apart or inject an explosive velocity', () => {
  const world = createCitizenPhysicsWorld(),
    doll = new CitizenRagdoll(world, { x: 0, y: 0, z: 0 });
  doll.hold({ x: 0, y: 0.32 * CITIZEN_SCALE, z: 0 });
  doll.move({ x: 12, y: 9, z: 0 });
  let maxSeparation = 0,
    maxSpeed = 0;
  for (let i = 0; i < 260; i++) {
    world.step(1 / 120);
    for (const joint of doll.constraints)
      maxSeparation = Math.max(
        maxSeparation,
        joint.bodyA
          .pointToWorldFrame(joint.pivotA)
          .distanceTo(joint.bodyB.pointToWorldFrame(joint.pivotB)),
      );
    for (const body of Object.values(doll.bodies))
      maxSpeed = Math.max(maxSpeed, body.velocity.length());
  }
  assert.ok(maxSeparation < 0.025, `Stretched miniature joint: ${maxSeparation}`);
  assert.ok(maxSpeed < MAX_HAND_SPEED * 1.35, `Unsafe drag energy: ${maxSpeed}`);
  assert.ok(Math.abs(doll.position.x - 12) < 0.06);
  doll.dispose();
});

test('careful ground-level release is safe; a high or fast release is physical', () => {
  assert.equal(
    isGentleRelease({ x: 0, y: 1 + 0.32 * CITIZEN_SCALE, z: 0 }, 1, { x: 0, y: 0, z: 0 }),
    true,
  );
  assert.equal(isGentleRelease({ x: 0, y: 1.2, z: 0 }, 1, { x: 0.4, y: 0.2, z: 0 }), true);
  assert.equal(isGentleRelease({ x: 0, y: 3, z: 0 }, 1, { x: 0, y: 0, z: 0 }), false);
  assert.equal(
    isGentleRelease({ x: 0, y: 1 + 0.32 * CITIZEN_SCALE, z: 0 }, 1, { x: 8, y: 0, z: 0 }),
    false,
  );
  const world = createCitizenPhysicsWorld();
  floor(world);
  let impacts = 0;
  const doll = new CitizenRagdoll(
    world,
    { x: 0, y: 0.025, z: 0 },
    0,
    CITIZEN_SCALE,
    () => impacts++,
  );
  doll.release({ x: 0, y: 0, z: 0 });
  step(world, 3);
  assert.equal(impacts, 0);
  assert.ok(doll.position.y > -0.1);
  doll.dispose();
});

test('a thrown citizen collides with ground exactly once and gives an outward contact normal', () => {
  const world = createCitizenPhysicsWorld();
  floor(world);
  const impacts: {
    point: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
    speed: number;
  }[] = [];
  const doll = new CitizenRagdoll(world, { x: 0, y: 3, z: 0 }, 0, CITIZEN_SCALE, (hit) =>
    impacts.push(hit),
  );
  doll.release({ x: 0, y: -9, z: 0 });
  step(world, 3);
  assert.equal(impacts.length, 1);
  assert.ok(impacts[0].speed >= IMPACT_THRESHOLD);
  assert.ok(impacts[0].normal.y > 0.9);
  assert.ok(Math.abs(impacts[0].point.y) < 0.001);
  doll.dispose();
});

test('fast sideways throws hit walls and report a vertical-surface normal', () => {
  const world = createCitizenPhysicsWorld();
  floor(world);
  world.addBody(
    new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(0.25, 3, 3)),
      position: new CANNON.Vec3(1, 2, 0),
      collisionFilterGroup: 1,
      collisionFilterMask: 2,
    }),
  );
  const normals: { x: number; y: number; z: number }[] = [];
  const doll = new CitizenRagdoll(world, { x: -1, y: 1, z: 0 }, 0, CITIZEN_SCALE, (hit) =>
    normals.push(hit.normal),
  );
  doll.release({ x: 12, y: 0, z: 0 });
  step(world, 1);
  assert.equal(normals.length, 1);
  assert.ok(normals[0].x < -0.9);
  doll.dispose();
});

test('nearby pedestrians and police witness incidents, an isolated abduction stays unwitnessed', () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(isCitizenIncidentWitnessed(origin, [{ x: 4, y: 0, z: 2 }], []), true);
  assert.equal(isCitizenIncidentWitnessed(origin, [{ x: 9, y: 0, z: 2 }], []), false);
  assert.equal(isCitizenIncidentWitnessed(origin, [], [{ x: 6, y: 0, z: 0 }]), true);
  assert.equal(isCitizenIncidentWitnessed(origin, [], []), false);
});

test('ground and authored building colliders respect elevated terrain and actual upgraded height', () => {
  const state = city(),
    tile = state.tiles[11 * 40 + 8];
  tile.elevation = 3;
  tile.kind = 'commercial';
  tile.level = 3;
  const terrain = createGroundCollider(state, 8, 11);
  assert.ok(Math.abs(terrain.position.y + 8 - 3) < 0.001);
  const building = createBuildingCollider(state, tile);
  assert.ok(building);
  assert.equal(building.position.y, 3);
  assert.ok(building.shapes.some((shape) => (shape as CANNON.Box).halfExtents.y > 0.3));
  tile.kind = 'park';
  assert.equal(createBuildingCollider(state, tile), null);
});

test('instanced crowds spawn near city streets, vary their clothing, and obey pause', () => {
  const state = city(),
    system = createCitizens(state);
  const before = system.getDebug();
  assert.ok(before.count >= 24 && before.count <= MAX_CITIZENS);
  assert.equal(before.ragdolls, 0);
  assert.ok(
    system.group.children.filter((c) => c instanceof THREE.InstancedMesh).length <= 28,
    'At most twenty-seven crowd meshes plus one particle mesh',
  );
  const shirt = system.group.getObjectByName('citizen-torso') as THREE.InstancedMesh;
  assert.ok(shirt.instanceColor);
  assert.ok(new Set(Array.from(shirt.instanceColor.array)).size > 8);
  for (let i = 0; i < 10; i++) system.animate(0.03, false);
  assert.deepEqual(system.getDebug().positions, before.positions);
  for (let i = 0; i < 30; i++) system.animate(0.03, true);
  assert.notDeepEqual(system.getDebug().positions, before.positions);
  system.dispose();
});

test('picking, lifting, careful put-down and cancellation never emit an incident', () => {
  const state = city(),
    incidents: unknown[] = [],
    system = createCitizens(state, (i) => incidents.push(i));
  system.setEnabled(true);
  const p = system.getDebug().positions[0],
    ray = new THREE.Ray(
      new THREE.Vector3(p.x, p.y + 0.32 * CITIZEN_SCALE, p.z - 10),
      new THREE.Vector3(0, 0, 1),
    );
  assert.equal(system.pointerDown(ray, new THREE.Vector3(0, -0.7, 0.7), 0), true);
  assert.equal(system.holding, true);
  assert.equal(system.cursor, 'grabbing');
  assert.equal(system.pointerUp(200), true);
  assert.equal(system.getDebug().ragdolls, 0);
  assert.equal(incidents.length, 0);
  assert.equal(system.pointerDown(ray, new THREE.Vector3(0, -0.7, 0.7), 300), true);
  system.pointerMove(
    new THREE.Ray(new THREE.Vector3(p.x, p.y + 3, p.z - 10), new THREE.Vector3(0, 0, 1)),
    350,
  );
  for (let i = 0; i < 30; i++) system.animate(0.016, true);
  system.cancel();
  assert.equal(system.holding, false);
  assert.equal(system.getDebug().ragdolls, 0);
  assert.equal(incidents.length, 0);
  system.dispose();
});

test('persisted floor and wall splatters recreate with correct world positions and orientations', () => {
  const state = city();
  state.citizenEffects.incidents = [
    {
      id: 1,
      month: 0,
      x: 10.5,
      y: 1.06,
      z: 10.5,
      nx: 0,
      ny: 1,
      nz: 0,
      witnessed: true,
      kind: 'impact',
    },
    {
      id: 2,
      month: 0,
      x: 11.9,
      y: 1.9,
      z: 10.5,
      nx: -1,
      ny: 0,
      nz: 0,
      witnessed: true,
      kind: 'impact',
    },
    {
      id: 3,
      month: 0,
      x: 0,
      y: 1,
      z: 10,
      nx: 0,
      ny: 1,
      nz: 0,
      witnessed: false,
      kind: 'abduction',
    },
  ] satisfies CitizenIncident[];
  const system = createCitizens(state),
    marks = system.group.getObjectByName('persistent-citizen-splatters')!;
  assert.equal(marks.children.length, 2);
  assert.ok(Math.abs(marks.children[0].position.x + 9.5) < 0.001);
  const wallNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(marks.children[1].quaternion);
  assert.ok(wallNormal.x < -0.99);
  system.update(state);
  assert.equal(marks.children.length, 2);
  system.dispose();
});

test('impact stains have small irregular dark droplets and conform closely to the actual pavement', () => {
  const state = city();
  state.citizenEffects.incidents = [
    {
      id: 17,
      month: 0,
      x: 10.5,
      y: 1.0455,
      z: 10.5,
      nx: 0,
      ny: 1,
      nz: 0,
      witnessed: true,
      kind: 'impact',
    },
  ];
  const system = createCitizens(state),
    stain = system.group.getObjectByName('citizen-splatter-17') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
  assert.ok(stain);
  assert.equal(stain.material.color.getHex(), 0x752b2a);
  assert.equal(stain.material.emissive.getHex(), 0);
  const vertices = stain.geometry.getAttribute('position'),
    worldPoint = new THREE.Vector3();
  assert.ok(
    vertices.count > 120 && vertices.count < 1000,
    'Many fine droplets should be batched in one small mesh',
  );
  stain.updateMatrixWorld(true);
  let radius = 0;
  for (let i = 0; i < vertices.count; i++) {
    worldPoint.fromBufferAttribute(vertices, i).applyMatrix4(stain.matrixWorld);
    radius = Math.max(
      radius,
      Math.hypot(worldPoint.x - stain.position.x, worldPoint.z - stain.position.z),
    );
    assert.ok(
      Math.abs(worldPoint.y - citizenSurfaceHeight(state, worldPoint.x, worldPoint.z) - 0.0012) <
        0.00001,
      'The stain must sit on the visible surface without floating',
    );
  }
  assert.ok(
    radius > 0.07 && radius < 0.18,
    `Stain extent ${radius} must be proportional to miniature residents`,
  );
  system.dispose();
});

test('an off-centre stationary grab has no phantom throw velocity or casualty', () => {
  const state = city();
  state.stats.population = 1;
  const incidents: unknown[] = [],
    system = createCitizens(state, (i) => incidents.push(i));
  system.setEnabled(true);
  const p = system.getDebug().positions[0],
    ray = new THREE.Ray(
      new THREE.Vector3(p.x + CITIZEN_PICK_RADIUS * 0.8, p.y + 0.32 * CITIZEN_SCALE, p.z - 10),
      new THREE.Vector3(0, 0, 1),
    );
  assert.equal(system.pointerDown(ray, new THREE.Vector3(0, -0.7, 0.7), 0), true);
  system.pointerMove(ray, 16);
  system.pointerUp(17);
  for (let i = 0; i < 180; i++) system.animate(1 / 60, false);
  assert.equal(incidents.length, 0);
  assert.equal(system.getDebug().count, 1);
  assert.equal(system.getDebug().ragdolls, 0);
  system.dispose();
});

test('a very high upward throw remains airborne until a real impact rather than timing out', () => {
  const world = createCitizenPhysicsWorld();
  floor(world);
  let impacts = 0;
  const doll = new CitizenRagdoll(world, { x: 0, y: 50, z: 0 }, 0, CITIZEN_SCALE, () => impacts++);
  doll.release({ x: 0, y: MAX_HAND_SPEED, z: 0 });
  step(world, 3.51);
  assert.equal(doll.resting, false);
  assert.equal(impacts, 0);
  assert.ok(doll.position.y > 30);
  step(world, 8);
  assert.equal(impacts, 1);
  doll.dispose();
});

test('loading another same-size city removes held actors and cannot apply an old throw to it', () => {
  const state = city(),
    incidents: unknown[] = [],
    system = createCitizens(state, (i) => incidents.push(i));
  system.setEnabled(true);
  const p = system.getDebug().positions[0],
    ray = new THREE.Ray(
      new THREE.Vector3(p.x, p.y + 0.32 * CITIZEN_SCALE, p.z - 10),
      new THREE.Vector3(0, 0, 1),
    );
  assert.equal(system.pointerDown(ray, new THREE.Vector3(0, -0.7, 0.7), 0), true);
  system.pointerMove(
    new THREE.Ray(new THREE.Vector3(p.x, p.y + 3, p.z - 10), new THREE.Vector3(0, 0, 1)),
    100,
  );
  for (let i = 0; i < 20; i++) system.animate(0.016, true);
  const empty = createCity(193, true, 40);
  system.update(empty);
  assert.equal(system.holding, false);
  assert.equal(system.getDebug().count, 0);
  assert.equal(system.getDebug().ragdolls, 0);
  for (let i = 0; i < 200; i++) system.animate(0.016, true);
  assert.equal(incidents.length, 0);
  system.dispose();
});

test('stadium fields and airport runways are not enclosed by invisible facility boxes', () => {
  const state = city();
  const inside = (body: CANNON.Body, p: CANNON.Vec3) =>
    body.shapes.some((shape, i) => {
      const offset = body.shapeOffsets[i],
        half = (shape as CANNON.Box).halfExtents;
      return (
        Math.abs(p.x - offset.x) <= half.x &&
        Math.abs(p.y - offset.y) <= half.y &&
        Math.abs(p.z - offset.z) <= half.z
      );
    });
  const stadium = {
    ...state.tiles[20 * 40 + 20],
    kind: 'stadium' as const,
    level: 1,
    anchor: 20 * 40 + 20,
    rotation: 0 as const,
  };
  const stadiumBody = createBuildingCollider(state, stadium);
  assert.ok(stadiumBody);
  assert.ok(stadiumBody.shapes.length > 4);
  assert.equal(inside(stadiumBody, new CANNON.Vec3(2.5, 0.8, 2)), false);
  assert.equal(
    inside(stadiumBody, new CANNON.Vec3(2.5, 0.135, 2)),
    true,
    'The playing surface itself still catches a falling citizen',
  );
  const airport = { ...stadium, kind: 'airport' as const };
  const airportBody = createBuildingCollider(state, airport);
  assert.ok(airportBody);
  assert.equal(inside(airportBody, new CANNON.Vec3(4.5, 0.8, 0.9)), false);
  assert.equal(
    inside(airportBody, new CANNON.Vec3(4.5, 0.095, 0.9)),
    true,
    'The runway pavement itself must collide',
  );
});

test('residents hidden behind a building cannot be picked through its walls', () => {
  const state = city();
  state.stats.population = 1;
  const system = createCitizens(state);
  system.setEnabled(true);
  const p = system.getDebug().positions[0];
  // Place a broad explicit occluder in the ray, independent of randomized
  // sidewalk frontage selection and each small house's facade setback.
  const bx = Math.floor(p.x + state.size / 2) - 1,
    bz = Math.floor(p.z + state.size / 2) + 3;
  const building = state.tiles[bz * state.size + bx];
  for (let dz = 0; dz < 3; dz++)
    for (let dx = 0; dx < 3; dx++)
      Object.assign(state.tiles[(bz + dz) * state.size + bx + dx], {
        kind: 'commercial',
        level: 2,
        anchor: bz * state.size + bx,
      });
  Object.assign(building, { lotWidth: 3, lotDepth: 3 });
  state.revision++;
  system.update(state);
  const blocked = new THREE.Ray(
    new THREE.Vector3(p.x, p.y + 0.32 * CITIZEN_SCALE, p.z + 10),
    new THREE.Vector3(0, 0, -1),
  );
  assert.equal(system.pointerDown(blocked, new THREE.Vector3(0, -0.7, -0.7), 0), false);
  const visible = new THREE.Ray(
    new THREE.Vector3(p.x, p.y + 0.32 * CITIZEN_SCALE, p.z - 10),
    new THREE.Vector3(0, 0, 1),
  );
  assert.equal(system.pointerDown(visible, new THREE.Vector3(0, -0.7, 0.7), 0), true);
  system.dispose();
});

test('the metropolitan crowd stays in 27 shared batches at the bounded resident cap', () => {
  const state = city();
  state.stats.population = 100000;
  const system = createCitizens(state);
  try {
    assert.equal(system.getDebug().count, MAX_CITIZENS);
    const meshes = system.group.children.filter(
      (object): object is THREE.InstancedMesh =>
        object instanceof THREE.InstancedMesh && object.name.startsWith('citizen-'),
    );
    assert.equal(meshes.length, 27);
    assert.equal(
      new Set(meshes.map((mesh) => mesh.material)).size,
      1,
      'All people share one material',
    );
    for (let frame = 0; frame < 90; frame++) system.animate(1 / 60, true);
    for (const mesh of meshes) {
      assert.equal(mesh.count, MAX_CITIZENS);
      assert.ok(
        Array.from(mesh.instanceMatrix.array).every(Number.isFinite),
        `${mesh.name} contains a broken animation transform`,
      );
    }
    const head = meshes.find((mesh) => mesh.name === 'citizen-head')!,
      vertices = head.geometry.getAttribute('position');
    let chinWidth = 0,
      cheekWidth = 0;
    for (let i = 0; i < vertices.count; i++) {
      if (vertices.getY(i) < -0.3) chinWidth = Math.max(chinWidth, Math.abs(vertices.getX(i)));
      if (Math.abs(vertices.getY(i)) < 0.1)
        cheekWidth = Math.max(cheekWidth, Math.abs(vertices.getX(i)));
    }
    assert.ok(chinWidth < cheekWidth * 0.8, 'Adult jaw silhouette must taper below the cheeks');
  } finally {
    system.dispose();
  }
});

test('metropolitan pedestrians favor inhabited frontage over equal-length remote industry streets', () => {
  const state = city();
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.level = 0;
  }
  for (let x = 5; x < 35; x++) {
    for (const z of [10, 20, 28]) state.tiles[z * 40 + x].kind = 'road';
    Object.assign(state.tiles[11 * 40 + x], { kind: 'residential', level: 3 });
    Object.assign(state.tiles[29 * 40 + x], { kind: 'industrial', level: 3 });
  }
  state.stats.population = 100000;
  state.revision++;
  const system = createCitizens(state);
  try {
    const people = system.getDebug().positions;
    assert.equal(people.length, MAX_CITIZENS);
    const homes = people.filter((p) => p.z < -7).length,
      industry = people.filter((p) => p.z > 7).length;
    assert.ok(homes > people.length * 0.85, `${homes} residents should favor inhabited streets`);
    assert.ok(industry > 0, 'industrial employment streets retain some pedestrians');
    assert.equal(homes + industry, people.length, 'uninhabited transit grid receives no crowd');
  } finally {
    system.dispose();
  }
});

test('camera detail culling preserves pedestrian identities and paused positions', () => {
  const state = city();
  state.stats.population = 100000;
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(-10, 30, -9.5);
  camera.lookAt(-10, 1, -9.5);
  camera.updateMatrixWorld(true);
  const system = createCitizens(state, undefined, {
    container: {} as HTMLElement,
    getCamera: () => camera,
  });
  try {
    const before = system.getDebug().positions;
    system.animate(1 / 60, false);
    const close = system.getDebug();
    assert.ok(
      close.rendered > 0 && close.rendered < MAX_CITIZENS / 2,
      'close view renders only nearby detailed instances',
    );
    assert.deepEqual(
      close.positions,
      before,
      'culling neither despawns nor teleports simulation actors',
    );
    camera.left = -30;
    camera.right = 30;
    camera.top = 30;
    camera.bottom = -30;
    camera.updateProjectionMatrix();
    system.animate(1 / 60, false);
    assert.equal(system.getDebug().rendered, MAX_CITIZENS, 'overview restores all visible people');
    assert.deepEqual(system.getDebug().positions, before);
  } finally {
    system.dispose();
  }
});

test('camera culling never removes a held resident from rendering or physics', () => {
  const state = city();
  state.stats.population = 1;
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(1000, 30, 1000);
  camera.lookAt(1000, 1, 1000);
  camera.updateMatrixWorld(true);
  const system = createCitizens(state, undefined, {
    container: {} as HTMLElement,
    getCamera: () => camera,
  });
  try {
    const person = system.getDebug().positions[0];
    system.setEnabled(true);
    const ray = new THREE.Ray(
      new THREE.Vector3(person.x, person.y + 0.32 * CITIZEN_SCALE, person.z - 1),
      new THREE.Vector3(0, 0, 1),
    );
    assert.equal(system.pointerDown(ray, new THREE.Vector3(0, -0.7, 0.7), 0), true);
    system.animate(1 / 60, false);
    assert.equal(system.getDebug().rendered, 1);
    assert.equal(system.getDebug().held, person.id);
    assert.equal(system.getDebug().ragdolls, 1);
  } finally {
    system.dispose();
  }
});

test('immutable monthly worker snapshots preserve held residents and active physics', () => {
  const state = city(),
    incidents: unknown[] = [];
  const system = createCitizens(state, (event) => incidents.push(event));
  try {
    system.setEnabled(true);
    const p = system.getDebug().positions[0];
    const ray = new THREE.Ray(
      new THREE.Vector3(p.x, p.y + 0.32 * CITIZEN_SCALE, p.z - 1),
      new THREE.Vector3(0, 0, 1),
    );
    assert.equal(system.pointerDown(ray, new THREE.Vector3(0, -0.7, 0.7), 0), true);
    const before = system.getDebug();
    const next = structuredClone(state);
    next.month++;
    next.revision++;
    system.update(next);
    assert.equal(system.getDebug().held, before.held);
    assert.equal(system.getDebug().ragdolls, 1);
    assert.equal(system.getDebug().count, before.count);
    assert.deepEqual(system.getDebug().positions, before.positions);
    system.animate(1 / 60, false);
    assert.equal(system.holding, true);
    assert.equal(incidents.length, 0);
    system.cancel();
  } finally {
    system.dispose();
  }
});

test('holding ignores ground, release restores collision and clears below-ground placement', () => {
  const world = createCitizenPhysicsWorld();
  floor(world);
  const doll = new CitizenRagdoll(world, { x: 0, y: 0.2, z: 0 });
  doll.hold({ x: 0, y: -0.3, z: 0 });
  step(world, 0.8);
  assert.ok(doll.position.y < -0.1, 'held body may cross ground without snagging');
  assert.ok(
    Object.values(doll.bodies).every((body) => body.collisionFilterMask === 4),
    'only buildings collide while held',
  );
  doll.clearGroundPenetration(() => 0);
  for (const body of Object.values(doll.bodies)) {
    body.updateAABB();
    assert.ok(body.aabb.lowerBound.y >= 0.001);
  }
  doll.release({ x: 0, y: 0, z: 0 });
  step(world, 2);
  assert.ok(Object.values(doll.bodies).every((body) => body.collisionFilterMask === 5));
  assert.ok(doll.position.y >= 0, 'released body rests above ground');
  doll.dispose();
});

test('ordinary three-metre free fall lands and settles without fatal disappearance', () => {
  const world = createCitizenPhysicsWorld();
  floor(world);
  let impacts = 0;
  const doll = new CitizenRagdoll(world, { x: 0, y: 0.3, z: 0 }, 0, CITIZEN_SCALE, () => impacts++);
  doll.release({ x: 0, y: 0, z: 0 });
  step(world, 4);
  assert.equal(impacts, 0);
  assert.equal(doll.resting, true);
  for (const body of Object.values(doll.bodies)) {
    body.updateAABB();
    assert.ok(body.aabb.lowerBound.y > -0.01);
  }
  doll.dispose();
});
