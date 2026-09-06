import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoadNetwork, roadPointKey } from '../../src/traffic/network';
import { createTrafficController, type TrafficVehicle } from '../../src/traffic/controller';
import {
  advanceTrafficRoute,
  prepareTrafficRoute,
  type TrafficRouteState,
} from '../../src/traffic/flow';
import { lanePose } from '../../src/traffic/lanes';
import { createCity } from '../../src/simulation/city-simulation';
import type { Tile } from '../../src/domain/types';
function grid() {
  const tiles: Tile[] = [];
  for (let x = 0; x < 25; x++)
    for (let z = 0; z < 25; z++)
      if (
        ([2, 12, 22].includes(x) && z >= 2 && z <= 22) ||
        ([2, 12, 22].includes(z) && x >= 2 && x <= 22)
      )
        tiles.push({ x, z, kind: 'road' } as Tile);
  return buildRoadNetwork({ tiles });
}
function fleet(network = grid(), count = 30) {
  const controller = createTrafficController(network),
    routes: TrafficRouteState[] = [],
    occupants: TrafficVehicle[] = [];
  const available = [...network.roads.values()].filter(
    (p) => !network.junctionAt.has(roadPointKey(p)),
  );
  for (let i = 0; i < count; i++) {
    const from = available[Math.floor((i * available.length) / count)],
      neighbors = network.neighbors.get(roadPointKey(from))!,
      to = neighbors[i % neighbors.length],
      previous = neighbors.find((p) => p !== to) ?? to;
    const route: TrafficRouteState = { from, to, previous, progress: 0.5, turn: i };
    routes.push(route);
    const pose = lanePose(previous, from, to, 0.5);
    occupants.push({
      id: i + 1,
      x: pose.x,
      z: pose.z,
      yaw: pose.yaw,
      halfWidth: i % 5 === 0 ? 0.1325 : 0.105,
      halfLength: i % 5 === 0 ? 0.31125 : 0.2,
    });
  }
  function step(dt: number) {
    controller.update(dt, occupants);
    for (const i of routes
      .map((_, i) => i)
      .sort(
        (a, b) =>
          Number(controller.hasReservation(b + 1)) - Number(controller.hasReservation(a + 1)),
      ))
      advanceTrafficRoute(routes[i], i + 1, 0.48, dt, network, controller, occupants);
  }
  return { controller, routes, occupants, step };
}
test('five-minute mixed truck city flow keeps completing junctions and no vehicle remains deadlocked', () => {
  const f = fleet();
  for (let i = 0; i < 7200; i++) f.step(1 / 40);
  const first = f.routes.map((r) => r.travelled ?? 0),
    completed = f.controller.getDebug().completed;
  for (let i = 0; i < 4800; i++) f.step(1 / 40);
  const stalled = f.routes
    .map((r, i) => ({
      id: i + 1,
      advanced: (r.travelled ?? 0) - first[i],
      from: r.from,
      to: r.to,
      waiting: r.waiting,
      movement: r.movement,
    }))
    .filter((r) => r.advanced < 0.5);
  assert.equal(
    stalled.length,
    0,
    JSON.stringify({
      stalled,
      positions: f.occupants.filter((v) => v.id === 1 || v.id === 6),
      routes: f.routes.filter((_, i) => i === 0 || i === 5),
      debug: f.controller.getDebug(),
    }),
  );
  assert.ok(f.controller.getDebug().completed > completed + 15);
});
test('same free lane distance at 30, 60 and 144 FPS and paused flow', () => {
  const totals = [];
  for (const fps of [30, 60, 144]) {
    const f = fleet(grid(), 1);
    for (let i = 0; i < fps * 4; i++) f.step(1 / fps);
    totals.push(f.routes[0].travelled!);
    f.step(0);
    assert.equal(f.routes[0].travelled, totals.at(-1));
  }
  assert.ok(Math.max(...totals) - Math.min(...totals) < 0.002, JSON.stringify(totals));
});
test('two-way roads with dead ends continue circulating without an unrecoverable turnaround jam', () => {
  const tiles: Tile[] = [];
  for (let i = 0; i < 24; i++) tiles.push({ x: i, z: 4, kind: 'road' } as Tile);
  const f = fleet(buildRoadNetwork({ tiles }), 8);
  for (let i = 0; i < 8000; i++) f.step(0.025);
  const distances = f.routes.map((r) => r.travelled ?? 0);
  for (let i = 0; i < 4000; i++) f.step(0.025);
  assert.ok(
    f.routes.every((r, i) => (r.travelled ?? 0) - distances[i] > 1),
    JSON.stringify({
      cars: f.routes.map((r, i) => ({
        id: i + 1,
        from: r.from,
        to: r.to,
        waiting: r.waiting,
        travelled: r.travelled,
      })),
      debug: f.controller.getDebug(),
    }),
  );
});

test('starter-city topology keeps real mixed traffic moving over eight simulated minutes', () => {
  const state = createCity(2026),
    network = buildRoadNetwork(state);
  const f = fleet(network, Math.min(40, Math.floor(network.roads.size / 5)));
  for (let i = 0; i < 12000; i++) f.step(0.025);
  const distances = f.routes.map((r) => r.travelled ?? 0);
  for (let i = 0; i < 7200; i++) f.step(0.025);
  const stalled = f.routes
    .map((r, i) => ({
      id: i + 1,
      distance: (r.travelled ?? 0) - distances[i],
      from: r.from,
      to: r.to,
      waiting: r.waiting,
    }))
    .filter((r) => r.distance < 1);
  assert.equal(stalled.length, 0, JSON.stringify({ stalled, debug: f.controller.getDebug() }));
});

test('adding roads that enlarge a junction replans a waiting car even when its old entrance survives', () => {
  const tiles: Tile[] = [];
  for (let i = 2; i <= 8; i++) {
    tiles.push({ x: i, z: 5, kind: 'road' } as Tile);
    if (i !== 5) tiles.push({ x: 5, z: i, kind: 'road' } as Tile);
  }
  const before = buildRoadNetwork({ tiles }),
    controller = createTrafficController(before),
    car: TrafficRouteState = {
      previous: { x: 3, z: 5 },
      from: { x: 4, z: 5 },
      to: { x: 5, z: 5 },
      progress: 0.4,
      turn: 0,
    };
  prepareTrafficRoute(car, before, controller, 1);
  const old = car.movement!.junctionId;
  tiles.push({ x: 6, z: 6, kind: 'road' } as Tile);
  const changed = buildRoadNetwork({ tiles });
  controller.rebuild(changed);
  prepareTrafficRoute(car, changed, controller, 1);
  assert.notEqual(car.movement!.junctionId, old);
  assert.equal(
    car.movement!.junctionId,
    changed.approaches.get(car.movement!.approachId)!.junctionId,
  );
});

test('two cars already turning in a short post-demolition cul-de-sac clear the adjoining intersection', () => {
  const tiles: Tile[] = [];
  for (let x = 1; x <= 7; x++) tiles.push({ x, z: 4, kind: 'road' } as Tile);
  for (let z = 3; z <= 7; z++) if (z !== 4) tiles.push({ x: 4, z, kind: 'road' } as Tile);
  const network = buildRoadNetwork({ tiles }),
    controller = createTrafficController(network);
  const routes: TrafficRouteState[] = [0.0989021201, 0.5077829265].map((progress, i) => ({
    previous: { x: 4, z: 4 },
    from: { x: 4, z: 3 },
    to: { x: 4, z: 4 },
    progress,
    turn: i,
  }));
  const occupants: TrafficVehicle[] = routes.map((r, i) => ({
    id: i + 1,
    ...lanePose(r.previous, r.from, r.to, r.progress),
    halfWidth: 0.1055,
    halfLength: 0.19325,
  }));
  for (let frame = 0; frame < 4800; frame++) {
    controller.update(0.025, occupants);
    for (let i = 0; i < routes.length; i++)
      advanceTrafficRoute(routes[i], i + 1, 0.48, 0.025, network, controller, occupants);
  }
  assert.ok(
    routes.every((r) => (r.travelled ?? 0) > 12),
    JSON.stringify(routes),
  );
  assert.ok(controller.getDebug().completed > 8);
});
