import assert from 'node:assert/strict';
import test from 'node:test';
import { createCitizenLife } from '../../src/citizens/life.ts';
import { createPedestrianGraph, type PedestrianGraph } from '../../src/citizens/routing.ts';
import { createCity } from '../../src/simulation/city-simulation.ts';

function fixture() {
  const state = createCity(42, true, 40);
  for (const tile of state.tiles)
    Object.assign(tile, { kind: 'empty', level: 0, elevation: 1, fire: 0, anchor: -1 });
  for (let x = 10; x <= 18; x++) state.tiles[15 * state.size + x].kind = 'road';
  Object.assign(state.tiles[14 * state.size + 11], { kind: 'residential', level: 1 });
  Object.assign(state.tiles[14 * state.size + 17], { kind: 'commercial', level: 1 });
  state.tiles[16 * state.size + 14].kind = 'park';
  const rebuild = () =>
    createPedestrianGraph(
      state,
      state.tiles.flatMap((t, i) => (t.kind === 'road' || t.kind === 'park' ? [i] : [])),
    );
  const graph = rebuild();
  const life = createCitizenLife();
  life.update(state, graph);
  const start = graph.nodes.find((n) => n.tile === 15 * state.size + 10)!.id;
  return { state, graph, life, start, rebuild };
}
function walk(
  life: ReturnType<typeof createCitizenLife>,
  graph: PedestrianGraph,
  id: number,
  start: number,
) {
  let node = start;
  for (let i = 0; i <= graph.nodes.length * 2; i++) {
    const step = life.step(id, node);
    if (step.waiting) {
      assert.equal(step.edge, undefined);
      return { node, step };
    }
    assert.ok(step.edge, 'reachable destination must produce an edge or wait');
    assert.ok(
      graph
        .neighbors(node)
        .some((e) => e.node === step.edge!.node && e.crosswalk === step.edge!.crosswalk),
    );
    node = step.edge.node;
  }
  assert.fail('did not arrive within bounded graph traversal');
}

test('daily routines reach real employers, parks and homes using legal edges', () => {
  const { state, graph, life, start } = fixture();
  const before = JSON.stringify(state);
  life.advance(0, true, 9);
  const work = walk(life, graph, 1, start);
  assert.equal(work.step.activity, 'working');
  assert.equal(graph.byId.get(work.node)!.tile, 15 * state.size + 17);
  for (let i = 0; i < 100; i++) assert.equal(life.step(1, work.node).waiting, true);
  life.advance(31, true, 9);
  assert.equal(life.step(1, work.node).activity, 'strolling');
  life.advance(0, true, 17);
  const park = walk(life, graph, 1, work.node);
  assert.equal(park.step.activity, 'leisure');
  assert.equal(state.tiles[graph.byId.get(park.node)!.tile].kind, 'park');
  life.advance(0, true, 21);
  const home = walk(life, graph, 1, park.node);
  assert.equal(home.step.activity, 'home');
  assert.equal(graph.byId.get(home.node)!.tile, 15 * state.size + 11);
  assert.equal(JSON.stringify(state), before);
});

test('pause freezes both dwell timers and phases', () => {
  const { life, graph, start } = fixture();
  const work = walk(life, graph, 2, start);
  life.advance(10000, false, 22);
  assert.equal(life.step(2, work.node).activity, 'working');
  assert.equal(life.step(2, work.node).waiting, true);
  assert.equal(life.getDiagnostics().clock, 0);
  life.advance(30, true, 12);
  assert.equal(life.step(2, work.node).waiting, false);
});

test('no employer never claims work, rebuild invalidates deleted roads and destinations', () => {
  const { state, life, start, rebuild } = fixture();
  state.tiles[14 * state.size + 17].level = 0;
  life.update(state, rebuild());
  assert.equal(life.step(3, start).activity, 'strolling');
  state.tiles[15 * state.size + 10].kind = 'empty';
  life.update(state, rebuild());
  assert.deepEqual(life.step(3, start), { activity: 'strolling', waiting: false });
  assert.equal(life.getSnapshot().total, 0);
});

test('unsafe sites reject before invitations or cooldown and can be retried immediately', () => {
  const { life, graph, start } = fixture();
  const near = graph.nodes.find((n) => n.tile === 16 * 40 + 14)!;
  const source = graph.byId.get(start)!;
  const candidates = [{ id: 1, node: start, x: source.x, z: source.z }];
  const before = life.getSnapshot();
  let checks = 0;
  assert.deepEqual(
    life.trigger('festival', near, [], () => {
      checks++;
      return false;
    }),
    { ok: false, reason: 'no-people' },
  );
  assert.equal(checks, 0, 'No venue construction before finding eligible guests');
  assert.deepEqual(
    life.trigger('festival', near, candidates, () => {
      checks++;
      return false;
    }),
    { ok: false, reason: 'no-place' },
  );
  assert.equal(checks, 1);
  assert.deepEqual(
    life.getSnapshot(),
    before,
    'Rejected furniture placement must not commit event state',
  );
  assert.equal(life.trigger('festival', near, candidates, () => true).ok, true);
});

test('a reachable park without room falls back to the next reachable park', () => {
  const { state, life, start, rebuild } = fixture();
  state.tiles[16 * 40 + 17].kind = 'park';
  const graph = rebuild();
  life.update(state, graph);
  const near = graph.nodes.find((n) => n.tile === 16 * 40 + 14)!;
  const source = graph.byId.get(start)!;
  const tried: number[] = [];
  const result = life.trigger(
    'festival',
    near,
    [{ id: 1, node: start, x: source.x, z: source.z }],
    (site) => {
      const tile = Math.floor(site.z + 20) * 40 + Math.floor(site.x + 20);
      tried.push(tile);
      return tile === 16 * 40 + 17;
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(tried, [16 * 40 + 14, 16 * 40 + 17]);
  if (result.ok) assert.equal(Math.floor(result.event.x + 20), 17);
});

test('events cap invitations, gather in the park until expiry, pause and enforce cooldown', () => {
  const { life, graph, start, state } = fixture();
  const near = graph.nodes.find((n) => n.tile === 16 * 40 + 14)!;
  const source = graph.byId.get(start)!;
  const candidates = Array.from({ length: 30 }, (_, id) => ({
    id,
    node: start,
    x: source.x,
    z: source.z,
  }));
  const result = life.trigger('gathering', near, candidates);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.invited, 18);
  assert.deepEqual(life.trigger('festival', near, candidates), { ok: false, reason: 'active' });
  const destinations = new Set<number>();
  for (let id = 0; id < 18; id++) {
    const arrival = walk(life, graph, id, start);
    assert.equal(arrival.step.activity, 'socialising');
    const target = graph.byId.get(arrival.node)!;
    assert.equal(state.tiles[target.tile].kind, 'park');
    assert.ok(Math.hypot(target.x - result.event.x, target.z - result.event.z) <= 0.6);
    destinations.add(arrival.node);
  }
  assert.ok(destinations.size > 1);
  assert.equal(life.getSnapshot().event!.arrived, 18);
  const paused = life.getSnapshot();
  life.advance(1000, false, 21);
  assert.deepEqual(life.getSnapshot(), paused);
  const node = life.getActorStatus(0)!.destination!;
  life.advance(result.event.remaining - 1, true, 21);
  assert.equal(
    life.getSnapshot().counts.social,
    18,
    'Evening must not clear active social statuses',
  );
  assert.deepEqual(life.step(0, node), {
    waiting: true,
    activity: 'socialising',
    destination: node,
  });
  life.forget(17);
  assert.equal(
    life.getSnapshot().event!.arrived,
    17,
    'Departed actors must not remain in present count',
  );
  assert.equal(life.getSnapshot().event!.invited, 18);
  life.advance(1, true, 21);
  assert.equal(life.getSnapshot().event, null);
  assert.equal(life.getActorStatus(1)!.waiting, false);
  assert.equal(life.getSnapshot().counts.social, 0);
  assert.deepEqual(life.trigger('festival', near, candidates), { ok: false, reason: 'cooldown' });
  life.advance(20, true, 12);
  assert.equal(life.trigger('festival', near, candidates).ok, true);
});

test('a disconnected nearest park falls back to the next reachable local park deterministically', () => {
  const { state, life, start, rebuild } = fixture();
  state.tiles[18 * 40 + 14].kind = 'park';
  const graph = rebuild();
  life.update(state, graph);
  const isolated = graph.nodes.find((n) => n.tile === 18 * 40 + 14)!;
  const source = graph.byId.get(start)!;
  const candidates = [{ id: 1, node: start, x: source.x, z: source.z }];
  const before = life.getDiagnostics().fieldBuilds;
  const result = life.trigger('festival', isolated, candidates);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const location = graph.nodes.find((n) => n.x === result.event.x && n.z === result.event.z)!;
  assert.equal(location.tile, 16 * 40 + 14);
  assert.equal(life.getDiagnostics().fieldBuilds - before, 2);
  const twin = createCitizenLife();
  twin.update(state, graph);
  assert.deepEqual(twin.trigger('festival', isolated, candidates), result);
  const arrival = walk(life, graph, 1, start);
  const target = graph.byId.get(arrival.node)!;
  assert.equal(state.tiles[target.tile].kind, 'park');
  life.advance(149, true, 12);
  assert.equal(life.step(1, arrival.node).waiting, true);
  life.advance(1, true, 12);
  assert.equal(life.getSnapshot().event, null);
  const resumed = life.step(1, arrival.node);
  assert.equal(resumed.waiting, false);
  assert.ok(graph.neighbors(arrival.node).some((e) => e.node === resumed.edge?.node));
});

test('unsuccessful venue search attempts at most eight parks and no per-actor searches', () => {
  const { state, life, rebuild } = fixture();
  for (let z = 18; z <= 22; z += 2)
    for (let x = 10; x <= 16; x += 2) state.tiles[z * 40 + x].kind = 'park';
  life.update(state, rebuild());
  const before = life.getDiagnostics().fieldBuilds;
  assert.deepEqual(life.trigger('gathering', { x: -5.5, z: -0.5 }, []), {
    ok: false,
    reason: 'no-people',
  });
  assert.equal(life.getDiagnostics().fieldBuilds - before, 8);
});

test('missing, far away and disconnected sites or actors never report success', () => {
  const { life, graph, state, rebuild, start } = fixture();
  const park = graph.nodes.find((n) => state.tiles[n.tile].kind === 'park')!;
  assert.deepEqual(life.trigger('gathering', park, []), { ok: false, reason: 'no-people' });
  assert.deepEqual(life.trigger('gathering', { x: 1000, z: 1000 }, []), {
    ok: false,
    reason: 'no-place',
  });
  // Delete the connection while retaining the isolated park.
  state.tiles[15 * 40 + 14].kind = 'empty';
  life.update(state, rebuild());
  const n = graph.byId.get(start)!;
  assert.deepEqual(life.trigger('gathering', park, [{ id: 1, node: start, x: n.x, z: n.z }]), {
    ok: false,
    reason: 'no-people',
  });
  state.tiles[16 * 40 + 14].kind = 'empty';
  life.update(state, rebuild());
  assert.deepEqual(life.trigger('gathering', park, []), { ok: false, reason: 'no-place' });
});

test('720 actors share fixed routing work; steps and repeated updates never run BFS', () => {
  const { life, graph, state, start } = fixture();
  const twin = createCitizenLife();
  twin.update(state, graph);
  const builds = life.getDiagnostics().fieldBuilds;
  for (let frame = 0; frame < 10; frame++) {
    life.update(state, graph);
    for (let id = 0; id < 720; id++) assert.deepEqual(life.step(id, start), twin.step(id, start));
  }
  assert.equal(life.getDiagnostics().fieldBuilds, builds);
  assert.equal(life.getSnapshot().total, 720);
  life.step(721, start);
  assert.equal(life.getSnapshot().total, 720);
  life.forget(1);
  assert.equal(life.getActorStatus(1), undefined);
  life.reset();
  assert.equal(life.getSnapshot().total, 0);
  assert.equal(life.getSnapshot().event, null);
});

test('active-node restriction applies to whole routes; rebuilding cancels an active event', () => {
  const { state, graph, life, start, rebuild } = fixture();
  const park = graph.nodes.find((n) => state.tiles[n.tile].kind === 'park')!;
  const n = graph.byId.get(start)!;
  assert.equal(life.trigger('festival', park, [{ id: 1, node: start, x: n.x, z: n.z }]).ok, true);
  life.update(state, rebuild(), [start]);
  assert.equal(life.getSnapshot().event, null);
  assert.equal(life.step(1, start).edge, undefined);
});
