import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCity } from '../../src/simulation/city-simulation.ts';
import {
  CitizenRagdoll,
  createCitizenPhysicsWorld,
  createCitizens,
  CITIZEN_SCALE,
} from '../../src/citizens/system.ts';
import { ImpactDebris } from '../../src/citizens/impact-debris.ts';

function floor(world: CANNON.World) {
  world.addBody(
    new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(100, 0.1, 100)),
      position: new CANNON.Vec3(0, -0.1, 0),
      collisionFilterGroup: 1,
      collisionFilterMask: 2,
    }),
  );
}
for (const height of [0.1, 0.2, 0.3, 1])
  test(`${height * 10}m drop ${height === 1 ? 'separates on real ground contact' : 'lands safely'}`, () => {
    const world = createCitizenPhysicsWorld();
    floor(world);
    const debris = new ImpactDebris(world, new THREE.Group());
    const hits: {
      speed: number;
      normal: { x: number; y: number; z: number };
      point: { x: number; y: number; z: number };
      time: number;
    }[] = [];
    const doll = new CitizenRagdoll(world, { x: 0, y: height, z: 0 }, 0, CITIZEN_SCALE, (hit) =>
      hits.push({ ...hit, time: world.time }),
    );
    doll.release({ x: 0, y: 0, z: 0 });
    for (let step = 0; step < 960 && !hits.length; step++) world.step(1 / 240);
    if (height === 1) {
      assert.equal(hits.length, 1, 'a ten-metre fall must reach the calibrated impact threshold');
      assert.ok(
        hits[0].time > 0.7 && hits[0].time < 1.05,
        'separation waits for the physical fall',
      );
      assert.ok(Math.abs(hits[0].point.y) < 0.005, 'impact occurs on the actual floor');
      assert.equal(
        debris.spawn({
          bodies: doll.bodies,
          scale: doll.scale,
          colors: { skin: 0xc89570, shirt: 0x245577, pants: 0x334455 },
          normal: hits[0].normal,
          speed: hits[0].speed,
        }),
        true,
      );
      assert.equal(debris.activeCount, 6);
    } else {
      assert.equal(hits.length, 0);
      assert.equal(doll.resting, true);
      assert.equal(debris.activeCount, 0);
    }
    doll.dispose();
    debris.dispose();
  });

function sceneGesture(azimuth: number, tilt: number) {
  const state = createCity(91, true, 40);
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.level = 0;
    tile.elevation = 0;
    tile.anchor = -1;
    tile.fire = 0;
  }
  for (let x = 5; x < 31; x++) {
    state.tiles[20 * 40 + x].kind = 'road';
    Object.assign(state.tiles[19 * 40 + x], { kind: 'residential', level: 1 });
  }
  state.stats.population = 1;
  state.revision++;
  const system = createCitizens(state),
    person = system.getDebug().positions[0];
  system.setEnabled(true);
  const target = new THREE.Vector3(person.x, person.y + 0.32 * CITIZEN_SCALE, person.z);
  const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.01, 100);
  camera.position
    .copy(target)
    .add(
      new THREE.Vector3(
        Math.sin(azimuth) * Math.sin(tilt),
        Math.cos(tilt),
        Math.cos(azimuth) * Math.sin(tilt),
      ).multiplyScalar(10),
    );
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  const caster = new THREE.Raycaster(),
    right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const ray = (point: THREE.Vector3) => {
    const projected = point.clone().project(camera);
    caster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
    return caster.ray.clone();
  };
  assert.equal(
    system.pointerDown(ray(target), camera.getWorldDirection(new THREE.Vector3()), 0),
    true,
  );
  let time = 0;
  const move = (point: THREE.Vector3, ms: number, advance = true) => {
    time += ms;
    system.pointerMove(ray(point), time);
    if (advance) system.animate(ms / 1000, false);
  };
  const settle = () => {
    for (let frame = 0; frame < 30; frame++) {
      time += 1000 / 60;
      system.animate(1 / 60, false);
    }
  };
  return {
    system,
    target,
    right,
    ray,
    move,
    settle,
    get time() {
      return time;
    },
  };
}

for (const [azimuth, tilt] of [
  [-0.7, 0.7],
  [0.65, 1.1],
  [0, 0.3],
])
  test(`lateral flick survives duplicate mouse-up sample at camera ${azimuth}/${tilt}`, () => {
    const g = sceneGesture(azimuth, tilt);
    try {
      for (let frame = 1; frame <= 60; frame++)
        g.move(g.target.clone().add(new THREE.Vector3(0, (frame / 60) * 0.8, 0)), 1000 / 60);
      g.settle();
      const lifted = g.target.clone().add(new THREE.Vector3(0, 0.8, 0));
      g.move(lifted.clone().addScaledVector(g.right, 0.12), 16);
      const releasePoint = lifted.clone().addScaledVector(g.right, 0.24);
      g.move(releasePoint, 16);
      const before = g.system.getDebug().positions[0];
      // Match scene.finishStroke exactly: final coordinates, then release.
      g.system.pointerMove(g.ray(releasePoint), g.time + 6);
      g.system.pointerUp(g.time + 6);
      const released = g.system.getDebug().positions[0];
      assert.equal(released.state, 'ragdoll');
      assert.ok(
        Math.abs(released.y - before.y) < 0.01,
        'release preserves the current airborne pose',
      );
      assert.ok(
        Math.hypot(released.x - before.x, released.z - before.z) < 0.001,
        'release does not teleport toward cursor or ground',
      );
      for (let frame = 0; frame < 8; frame++) g.system.animate(1 / 60, false);
      const after = g.system.getDebug().positions[0];
      assert.ok(
        (after.x - released.x) * g.right.x + (after.z - released.z) * g.right.z > 0.45,
        'the last meaningful flick velocity drives a lateral trajectory',
      );
      assert.ok(after.y > released.y - 0.16, 'sideways flick initially retains its height');
    } finally {
      g.system.dispose();
    }
  });

test('stationary final samples expire an old flick rather than refreshing it', () => {
  const g = sceneGesture(-0.7, 0.7);
  try {
    for (let frame = 1; frame <= 60; frame++)
      g.move(g.target.clone().add(new THREE.Vector3(0, (frame / 60) * 0.8, 0)), 1000 / 60);
    const stop = g.target
      .clone()
      .add(new THREE.Vector3(0, 0.8, 0))
      .addScaledVector(g.right, 0.25);
    g.move(stop, 16);
    for (let frame = 0; frame < 30; frame++) g.move(stop, 1000 / 60);
    const before = g.system.getDebug().positions[0];
    g.system.pointerMove(g.ray(stop), g.time + 6);
    g.system.pointerUp(g.time + 6);
    assert.equal(g.system.getDebug().positions[0].state, 'ragdoll');
    for (let frame = 0; frame < 8; frame++) g.system.animate(1 / 60, false);
    const after = g.system.getDebug().positions[0];
    assert.ok(
      Math.hypot(after.x - before.x, after.z - before.z) < 0.05,
      'a genuinely stationary hand releases without stored sideways momentum',
    );
  } finally {
    g.system.dispose();
  }
});

test('a quick grounded flick is not mistaken for careful put-down', () => {
  const g = sceneGesture(-0.7, 0.7);
  try {
    const releasePoint = g.target.clone().addScaledVector(g.right, 0.2);
    g.move(releasePoint, 16, false);
    g.system.pointerMove(g.ray(releasePoint), g.time + 6);
    g.system.pointerUp(g.time + 6);
    assert.equal(
      g.system.getDebug().positions[0].state,
      'ragdoll',
      'a flick must enter physics rather than recover at a sidewalk node',
    );
  } finally {
    g.system.dispose();
  }
});

test('ten-metre drop from the actual held pose produces pieces only after landing', () => {
  const g = sceneGesture(-0.7, 0.7);
  try {
    const original = g.system.getDebug().positions[0];
    for (let frame = 1; frame <= 60; frame++)
      g.move(g.target.clone().add(new THREE.Vector3(0, frame / 60, 0)), 1000 / 60);
    g.settle();
    const drop = g.target.clone().add(new THREE.Vector3(0, 1, 0));
    const before = g.system.getDebug().positions[0];
    assert.ok(before.y - original.y > 0.97);
    g.system.pointerMove(g.ray(drop), g.time + 6);
    g.system.pointerUp(g.time + 6);
    assert.equal(g.system.getDebug().debris, 0);
    for (let frame = 0; frame < 240 && !g.system.getDebug().debris; frame++)
      g.system.animate(1 / 60, false);
    assert.equal(
      g.system.getDebug().debris,
      6,
      'a held NPC dropped ten metres separates at the subsequent physical impact',
    );
  } finally {
    g.system.dispose();
  }
});
