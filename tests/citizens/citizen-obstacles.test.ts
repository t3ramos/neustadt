import assert from 'node:assert/strict';
import test from 'node:test';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { createPedestrianGraph, PARK_PATH_END } from '../../src/citizens/routing.ts';
import { createDrivingCollisionWorld } from '../../src/vehicles/collisions.ts';
import {
  citizenSurfaceHeight,
  citizenWalkingGait,
  CITIZEN_SCALE,
  createCitizens,
} from '../../src/citizens/system.ts';

function parkCity(variation: number) {
  const state = createCity(91, true, 40);
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.level = 0;
    tile.elevation = 0;
    tile.anchor = -1;
    tile.fire = 0;
  }
  const index = 20 * state.size + 20;
  Object.assign(state.tiles[index], { kind: 'park', variation, level: 1 });
  for (const [x, z] of [
    [20, 19],
    [21, 20],
    [20, 21],
    [19, 20],
  ])
    state.tiles[z * state.size + x].kind = 'road';
  Object.assign(state.tiles[18 * state.size + 20], { kind: 'commercial', level: 2 });
  Object.assign(state.tiles[22 * state.size + 20], { kind: 'residential', level: 2 });
  state.stats.population = 100;
  state.revision++;
  return { state, index };
}

test('obstacle-aware park routes retain entrances and detour around a blocked centre', () => {
  const { state, index } = parkCity(0),
    centre = 0.5;
  const graph = createPedestrianGraph(state, [index], {
    blocked: (_tile, x, z) => Math.abs(x - centre) < 0.2 && Math.abs(z - centre) < 0.2,
  });
  assert.equal(graph.byId.has(index * 8), false, 'solid centre cannot be a walking node');
  const seen = new Set<number>(),
    queue = [index * 8 + 4];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (seen.has(node)) continue;
    seen.add(node);
    for (const edge of graph.neighbors(node)) queue.push(edge.node);
  }
  for (let side = 0; side < 4; side++)
    assert.ok(seen.has(index * 8 + side + 4), 'each clear park entrance stays connected');
  for (const node of graph.nodes)
    for (const edge of graph.neighbors(node.id)) {
      const end = graph.byId.get(edge.node)!;
      for (let i = 0; i <= 40; i++) {
        const x = node.x + ((end.x - node.x) * i) / 40,
          z = node.z + ((end.z - node.z) * i) / 40;
        assert.ok(!(Math.abs(x - centre) < 0.2 && Math.abs(z - centre) < 0.2));
      }
    }
  assert.ok(
    graph.nodes.length < 50,
    'temporary occupancy grid is compressed into useful waypoints',
  );
});

for (let variation = 0; variation < 5; variation++)
  test(`park variant ${variation} walking segments clear the actual rendered props`, () => {
    const { state, index } = parkCity(variation),
      world = createDrivingCollisionWorld(state),
      body = { halfWidth: 0.025, halfLength: 0.025, height: 0.18 };
    try {
      const active = state.tiles
        .filter((t) => t.kind === 'road' || t.kind === 'park')
        .map((t) => t.z * state.size + t.x);
      const blocked = (tile: number, x: number, z: number) =>
        !!world.tileCollides(tile, x, z, 0, body, citizenSurfaceHeight(state, x, z) + 0.0012);
      const graph = createPedestrianGraph(state, active, { blocked });
      let parkEdges = 0;
      for (const start of graph.nodes)
        for (const edge of graph.neighbors(start.id)) {
          const end = graph.byId.get(edge.node)!;
          if (start.tile !== index && end.tile !== index) continue;
          parkEdges++;
          const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / 0.01));
          for (let i = 0; i <= steps; i++) {
            const x = start.x + ((end.x - start.x) * i) / steps,
              z = start.z + ((end.z - start.z) * i) / steps;
            const tile =
              Math.floor(z + state.size / 2) * state.size + Math.floor(x + state.size / 2);
            assert.equal(
              blocked(tile, x, z),
              false,
              `variant${variation} crossed prop at${x},${z}`,
            );
          }
        }
      assert.ok(parkEdges > 0, 'park remains usable around its visible furniture');
      if (variation === 1 || variation === 4)
        assert.equal(
          graph.byId.has(index * 8),
          false,
          'central fountain/statue is not a walk-through node',
        );
    } finally {
      world.dispose();
    }
  });

test('actual park walkers never advance through fountain, benches or raised beds', () => {
  const { state } = parkCity(1),
    world = createDrivingCollisionWorld(state),
    system = createCitizens(state),
    body = { halfWidth: 0.025, halfLength: 0.025, height: 0.18 };
  try {
    for (let frame = 0; frame < 360; frame++) {
      system.animate(0.05, true);
      for (const person of system.getDebug().positions) {
        const tile = Math.floor(person.z + 20) * 40 + Math.floor(person.x + 20);
        assert.equal(!!world.tileCollides(tile, person.x, person.z, 0, body, person.y), false);
      }
    }
  } finally {
    system.dispose();
    world.dispose();
  }
});

test('walking stance plants one foot while the other swings, with cadence driven by distance', () => {
  const stride = citizenWalkingGait(0).stride;
  const a = citizenWalkingGait(0.1 * Math.PI * 2),
    b = citizenWalkingGait(0.3 * Math.PI * 2);
  assert.equal(a.left.planted, true);
  assert.equal(b.left.planted, true);
  assert.ok(
    Math.abs(a.left.forward - (b.left.forward + 0.2 * stride)) < 1e-12,
    'world foot stays planted as torso advances',
  );
  assert.equal(a.left.lift, 0);
  assert.ok(a.right.lift > 0);
  for (let i = 0; i <= 200; i++) {
    const gait = citizenWalkingGait((i / 200) * Math.PI * 2);
    assert.ok(gait.left.lift >= 0 && gait.right.lift >= 0);
    assert.ok(gait.left.lift <= 0.045 * CITIZEN_SCALE + 1e-10);
    assert.ok(gait.right.lift <= 0.045 * CITIZEN_SCALE + 1e-10);
    assert.ok(gait.left.planted || gait.right.planted, 'at least one foot supports the body');
  }
  assert.ok(PARK_PATH_END < 0.5);
});
