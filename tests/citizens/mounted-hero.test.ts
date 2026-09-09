import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { createMountedHero } from '../../src/citizens/mounted-hero.ts';
import { createPedestrianGraph } from '../../src/citizens/routing.ts';
import { citizenSurfaceHeight } from '../../src/citizens/system.ts';
import { createDrivingCollisionWorld } from '../../src/vehicles/collisions.ts';

function fixture() {
  const state = createCity(42, true, 40);
  for (const tile of state.tiles)
    Object.assign(tile, { kind: 'empty', level: 0, elevation: 1, fire: 0, anchor: -1 });
  for (let x = 10; x < 29; x++) state.tiles[20 * state.size + x].kind = 'road';
  state.tiles[19 * state.size + 20].kind = 'park';
  state.speed = 1;
  return state;
}

test('mounted tribute follows real graph edges with bounded movement, finite poses and grounded stance', () => {
  const state = fixture(),
    hero = createMountedHero(state);
  const graph = createPedestrianGraph(
    state,
    state.tiles.flatMap((t, i) => (t.kind === 'road' ? [i] : [])),
  );
  assert.equal(hero.getDebug().visible, true);
  assert.ok(Math.abs(hero.group.position.x) < 4, 'spawns near central park');
  for (const [a, b] of hero.getDebug().routeEdges)
    assert.ok(graph.neighbors(a).some((e) => e.node === b));
  for (let i = 0; i < 1500; i++) {
    const before = hero.group.position.clone();
    hero.animate(1 / 30, true);
    assert.ok(before.distanceTo(hero.group.position) < 0.005);
    const d = hero.getDebug(),
      a = graph.byId.get(d.from!)!,
      b = graph.byId.get(d.to ?? d.from!)!;
    const p = hero.group.position;
    assert.ok(Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) < 1e-8);
    hero.group.updateMatrixWorld(true);
    for (const foot of d.feet) {
      assert.ok(foot.position.every(Number.isFinite));
      const world = hero.group.localToWorld(
        new THREE.Vector3(...(foot.position as [number, number, number])),
      );
      if (foot.planted)
        assert.ok(Math.abs(world.y - 0.008 - citizenSurfaceHeight(state, world.x, world.z)) < 1e-8);
    }
  }
  assert.ok(hero.getDebug().distance > 1);
  const bounds = new THREE.Box3().setFromObject(hero.group),
    size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.y < 0.38 && size.y > 0.3);
  assert.ok(hero.getDebug().meshCount < 30);
  assert.ok(hero.getDebug().triangles < 15000);
  hero.dispose();
});

test('pause freezes all movement; demolition does not teleport; disposal is idempotent', () => {
  const state = fixture(),
    hero = createMountedHero(state);
  hero.animate(0.1, true);
  const before = hero.getDebug();
  state.speed = 0;
  hero.update(state);
  hero.animate(20, true);
  assert.deepEqual(hero.getDebug().feet, before.feet);
  assert.deepEqual(hero.getDebug().position, before.position);
  state.speed = 1;
  hero.animate(0.1, false);
  hero.animate(NaN, true);
  hero.animate(-1, true);
  assert.deepEqual(hero.getDebug().position, before.position);
  const tile =
    state.tiles[
      Math.floor(hero.group.position.z + state.size / 2) * state.size +
        Math.floor(hero.group.position.x + state.size / 2)
    ];
  tile.kind = 'water';
  hero.update(state);
  hero.animate(0.1, true);
  assert.equal(hero.group.visible, false);
  assert.deepEqual(hero.getDebug().position, before.position);
  let released = 0;
  hero.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.addEventListener('dispose', () => released++);
  });
  hero.dispose();
  assert.ok(released > 0);
  const count = released;
  hero.dispose();
  assert.equal(released, count);
  assert.equal(hero.group.children.length, 0);
});

test('no route means no visible hero and no invented off-map spawn', () => {
  const state = fixture();
  for (const tile of state.tiles) tile.kind = 'water';
  const hero = createMountedHero(state);
  assert.equal(hero.group.visible, false);
  hero.animate(0.1, true);
  assert.equal(hero.getDebug().distance, 0);
  hero.dispose();
});

test('gallery scale and recentering cannot alter local leg or hoof poses', () => {
  const state = fixture(),
    normal = createMountedHero(state),
    displayed = createMountedHero(state);
  const parent = new THREE.Group();
  parent.scale.setScalar(9);
  parent.add(displayed.group);
  for (let i = 0; i < 100; i++) {
    const p = displayed.group.position;
    parent.position.set(-p.x * 9, -p.y * 9, -p.z * 9);
    parent.updateMatrixWorld(true);
    normal.animate(0.03, true);
    displayed.animate(0.03, true);
    assert.deepEqual(displayed.getDebug().feet, normal.getDebug().feet);
  }
  normal.dispose();
  displayed.dispose();
});

test('populated city starts visibly and keeps its horse hull clear of real model obstacles', () => {
  const state = createCity(42, false, 40);
  state.speed = 1;
  const hero = createMountedHero(state),
    collisions = createDrivingCollisionWorld(state);
  assert.equal(hero.group.visible, true);
  for (let i = 0; i < 1600; i++) {
    hero.animate(0.1, true);
    const p = hero.group.position;
    assert.equal(
      collisions.collides(
        p.x,
        p.z,
        hero.group.rotation.y,
        { halfWidth: 0.052, halfLength: 0.145, height: 0.37 },
        citizenSurfaceHeight(state, p.x, p.z),
      ),
      undefined,
    );
  }
  assert.ok(hero.getDebug().distance > 10);
  assert.ok(hero.getDebug().graphNodes < 3000);
  assert.ok(hero.getDebug().triangles < 15000);
  collisions.dispose();
  hero.dispose();
});
