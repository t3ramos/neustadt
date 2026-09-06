import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  ImpactDebris,
  DISMEMBERMENT_SPEED,
  IMPACT_DEBRIS_SECONDS,
  MAX_IMPACT_DEBRIS,
  VEHICLE_DISMEMBERMENT_SPEED,
} from '../../src/citizens/impact-debris.ts';
import { CitizenRagdoll, createCitizenPhysicsWorld } from '../../src/citizens/system.ts';

function fixture() {
  const world = createCitizenPhysicsWorld(),
    parent = new THREE.Group();
  const ragdoll = new CitizenRagdoll(world, { x: 0, y: 2, z: 0 });
  ragdoll.release({ x: 6, y: 0.5, z: -1 });
  const debris = new ImpactDebris(world, parent);
  const source = {
    bodies: ragdoll.bodies,
    scale: ragdoll.scale,
    colors: { skin: 0xc89570, shirt: 0x245577, pants: 0x334455 },
    normal: { x: -1, y: 0, z: 0 },
    speed: 6,
  };
  return { world, parent, ragdoll, debris, source };
}

test('low impacts keep the connected ragdoll; severe impacts preserve independent body momentum and palette', () => {
  const { world, parent, ragdoll, debris, source } = fixture();
  assert.equal(debris.spawn({ ...source, speed: DISMEMBERMENT_SPEED - 0.01 }), false);
  assert.equal(debris.activeCount, 0);
  assert.equal(world.constraints.length, 5);
  const total = (bodies: CANNON.Body[]) =>
    bodies.reduce(
      (p, b) => {
        p.x += b.velocity.x * b.mass;
        p.y += b.velocity.y * b.mass;
        p.z += b.velocity.z * b.mass;
        return p;
      },
      { x: 0, y: 0, z: 0 },
    );
  const before = total(Object.values(ragdoll.bodies));
  assert.equal(debris.spawn(source), true);
  ragdoll.dispose();
  assert.equal(world.constraints.length, 0);
  assert.equal(world.bodies.length, 6);
  const after = total(world.bodies);
  for (const axis of ['x', 'y', 'z'] as const)
    assert.ok(Math.abs(before[axis] - after[axis]) < 1e-9);
  assert.ok(new Set(world.bodies.map((b) => b.velocity.x)).size > 1);
  assert.ok(world.bodies.every((b) => b.angularVelocity.length() > 1));
  assert.equal(debris.activeCount, 6);
  assert.equal(
    parent.getObjectByName('detached-head') &&
      (
        parent.getObjectByName('detached-head') as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshStandardMaterial
        >
      ).material.color.getHex(),
    source.colors.skin,
  );
  debris.dispose();
});

test('detached parts hit ground, stay finite, pause and expire with all world bodies removed', () => {
  const { world, ragdoll, debris, source } = fixture();
  const floor = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(100, 0.1, 100)),
    position: new CANNON.Vec3(0, -0.1, 0),
    collisionFilterGroup: 1,
  });
  world.addBody(floor);
  debris.spawn(source);
  ragdoll.dispose();
  for (let i = 0; i < 1200; i++) {
    world.step(1 / 240);
    debris.update(1 / 240);
  }
  assert.equal(debris.activeCount, 6);
  for (const p of debris.positions) {
    assert.ok(Number.isFinite(p.x + p.y + p.z));
    assert.ok(p.y > -0.025);
  }
  const positions = debris.positions.map((p) => ({ ...p }));
  for (let i = 0; i < 20; i++) debris.update(0);
  assert.deepEqual(
    debris.positions.map((p) => ({ ...p })),
    positions,
  );
  debris.update(IMPACT_DEBRIS_SECONDS);
  assert.equal(debris.activeCount, 0);
  assert.deepEqual(world.bodies, [floor]);
  debris.dispose();
});

test('pool capacity, restored city clearing and disposal bound physics and render resources', () => {
  const { world, parent, ragdoll, debris, source } = fixture();
  for (let i = 0; i < 30; i++) debris.spawn(source);
  assert.equal(debris.activeCount, MAX_IMPACT_DEBRIS);
  assert.equal(debris.group.children.length, MAX_IMPACT_DEBRIS);
  assert.equal(world.bodies.length, MAX_IMPACT_DEBRIS + 6);
  const meshes = [...debris.group.children];
  debris.clear();
  assert.equal(debris.activeCount, 0);
  assert.equal(world.bodies.length, 6);
  debris.spawn(source);
  assert.deepEqual(debris.group.children, meshes);
  assert.equal(debris.activeCount, 6);
  debris.dispose();
  debris.dispose();
  ragdoll.dispose();
  assert.equal(world.bodies.length, 0);
  assert.equal(parent.children.length, 0);
  assert.equal(debris.spawn(source), false);
});

test('invalid impact data cannot introduce non-finite bodies or render transforms', () => {
  const { world, ragdoll, debris, source } = fixture();
  assert.equal(debris.spawn({ ...source, speed: Infinity }), false);
  source.bodies.head.position.x = NaN;
  assert.equal(debris.spawn(source), false);
  assert.equal(world.bodies.length, 6);
  source.bodies.head.position.x = 0;
  assert.equal(debris.spawn(source), true);
  world.bodies.at(-1)!.quaternion.w = NaN;
  debris.update(1 / 60);
  assert.equal(debris.activeCount, 5);
  debris.dispose();
  ragdoll.dispose();
});

test('real car-speed threshold differs from a normal ground landing speed', () => {
  const { ragdoll, debris, source } = fixture();
  assert.equal(debris.spawn({ ...source, speed: 1.9 }), false);
  assert.equal(
    debris.spawn({ ...source, speed: VEHICLE_DISMEMBERMENT_SPEED - 0.01, cause: 'vehicle' }),
    false,
  );
  assert.equal(
    debris.spawn({ ...source, speed: VEHICLE_DISMEMBERMENT_SPEED, cause: 'vehicle' }),
    true,
  );
  assert.equal(debris.activeCount, 6);
  debris.dispose();
  ragdoll.dispose();
});

test('detached parts collide with building colliders and are no longer joint-bound', () => {
  const { world, ragdoll, debris, source } = fixture();
  const wall = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(0.2, 5, 5)),
    position: new CANNON.Vec3(0.8, 0, 0),
    collisionFilterGroup: 4,
  });
  world.addBody(wall);
  debris.spawn(source);
  ragdoll.dispose();
  for (let i = 0; i < 240; i++) {
    world.step(1 / 240);
    debris.update(1 / 240);
  }
  assert.equal(world.constraints.length, 0);
  assert.equal(debris.activeCount, 6);
  assert.ok(debris.positions.every((p) => p.x < 0.65));
  debris.dispose();
});
