import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createCitizens,
  citizenSurfaceHeight,
  type CitizenSystem,
} from '../../src/citizens/system.ts';
import { createPedestrianGraph } from '../../src/citizens/routing.ts';
import { createDrivingCollisionWorld } from '../../src/vehicles/collisions.ts';
import { createCity } from '../../src/simulation/city-simulation.ts';
import type { CityState } from '../../src/domain/types.ts';
import { boxGeometry } from '../../src/rendering/buildings/primitives.ts';

type Walker = ReturnType<CitizenSystem['getDebug']>['positions'][number];
const DT = 0.05;
const EPS = 1e-8;
const venueOf = (system: CitizenSystem) =>
  system.group.children.find(
    (child): child is THREE.Group => child instanceof THREE.Group && !!child.userData.eventVenue,
  );

function fixture(hour = 12, paused = false) {
  const state = createCity(42, true, 40);
  for (const tile of state.tiles)
    Object.assign(tile, { kind: 'empty', level: 0, elevation: 1, fire: 0, anchor: -1 });
  for (let x = 10; x <= 18; x++) state.tiles[15 * 40 + x].kind = 'road';
  Object.assign(state.tiles[14 * 40 + 11], { kind: 'residential', level: 1 });
  Object.assign(state.tiles[14 * 40 + 17], { kind: 'commercial', level: 1 });
  Object.assign(state.tiles[16 * 40 + 14], { kind: 'park', variation: 0 });
  state.stats.population = 100;
  state.settings.timeOfDay = hour;
  state.speed = paused ? 0 : 1;
  state.revision++;
  return { state, system: createCitizens(state), near: { x: -5.5, z: -3.5 } };
}

/** Reconstruct the public walking graph with the same physical obstacles. This
 * only validates movement; it never selects actor routes or moves actors. */
function legalSegments(state: CityState) {
  const collision = createDrivingCollisionWorld(state);
  try {
    const graph = createPedestrianGraph(
      state,
      state.tiles.flatMap((t, i) => (t.kind === 'road' || t.kind === 'park' ? [i] : [])),
      {
        blocked: (index, x, z) =>
          !!collision.tileCollides(
            index,
            x,
            z,
            0,
            { halfWidth: 0.025, halfLength: 0.025, height: 0.18 },
            citizenSurfaceHeight(state, x, z) + 0.0012,
          ),
      },
    );
    return graph.nodes.flatMap((a) =>
      graph
        .neighbors(a.id)
        .filter((e) => e.node > a.id)
        .map((e) => ({ a, b: graph.byId.get(e.node)! })),
    );
  } finally {
    collision.dispose();
  }
}
type Segment = ReturnType<typeof legalSegments>[number];
function onSegment(p: Walker, { a, b }: Segment) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz);
  return t >= -EPS && t <= 1 + EPS && Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz) < EPS;
}
function distance(a: Walker, b: Walker) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function runner(system: CitizenSystem, state: CityState) {
  let before = system.getDebug().positions;
  const segments = legalSegments(state);
  assert.equal(before.length, 24);
  const traveled = new Map(before.map((p) => [p.id, 0]));
  return {
    traveled,
    frame(hour = 12, walking = true) {
      system.animate(DT, walking, hour);
      const after = system.getDebug().positions;
      assert.deepEqual(
        after.map((p) => p.id),
        before.map((p) => p.id),
        'No replacement actors may fake a trip',
      );
      for (let i = 0; i < after.length; i++) {
        const a = before[i],
          b = after[i];
        assert.equal(b.state, 'walking');
        const moved = distance(a, b);
        assert.ok(
          moved <= 0.16 * DT * (a.crossing || b.crossing ? 1.6 : 1) + EPS,
          `Actor ${b.id} snapped by ${moved}`,
        );
        assert.ok(
          segments.some((s) => onSegment(a, s) && onSegment(b, s)),
          `Actor ${b.id} left a legal graph edge at ${b.x},${b.z}`,
        );
        if (!walking) assert.deepEqual(b, a, 'Paused actor position and crossing must freeze');
        traveled.set(b.id, traveled.get(b.id)! + moved);
      }
      before = after;
      return after;
    },
  };
}
function atFrontage(p: Walker, x: number) {
  return Math.abs(p.z - (15 - 19.5 - 0.405)) < EPS && Math.abs(p.x - (x - 19.5)) <= 0.405 + EPS;
}

test('a city created paused at 17:00 starts with leisure and freezes its initial residents', () => {
  const { state, system } = fixture(17, true);
  try {
    const run = runner(system, state);
    const before = system.getLife();
    assert.equal(before.counts.work, 0);
    assert.ok(before.counts.leisure > 0, 'Initial routines must use the supplied city hour');
    for (let frame = 0; frame < 20; frame++) run.frame(17, false);
    assert.deepEqual(system.getLife(), before);
  } finally {
    system.dispose();
  }
});

test('animated residents travel to work, dwell there, then walk home and dwell without snapping', () => {
  const { state, system } = fixture();
  try {
    const run = runner(system, state);
    function reachAndDwell(hour: number, frontage: number) {
      const initialTravel = new Map(run.traveled);
      let previous = system.getDebug().positions;
      const stationary = new Map<number, number>();
      for (let frame = 0; frame < 1800; frame++) {
        const positions = run.frame(hour);
        for (let i = 0; i < positions.length; i++) {
          const p = positions[i];
          const frames =
            atFrontage(p, frontage) && distance(p, previous[i]) < EPS
              ? (stationary.get(p.id) ?? 0) + 1
              : 0;
          stationary.set(p.id, frames);
          if (frames >= 40 && run.traveled.get(p.id)! - initialTravel.get(p.id)! > 0.5) {
            assert.equal(p.crossing, false, 'Dwell must occur on pavement');
            return p;
          }
        }
        previous = positions;
      }
      assert.fail(`No real arrival and two-second dwell at frontage ${frontage} in 90 seconds`);
    }
    reachAndDwell(12, 17);
    assert.ok(system.getLife().counts.work > 0);
    reachAndDwell(21, 11);
    assert.ok(system.getLife().counts.home > 0);
    assert.equal(system.getLife().counts.work, 0);
  } finally {
    system.dispose();
  }
});

test('a gathering keeps real arrivals together on park paths until expiry, including pause', () => {
  const { state, system, near } = fixture();
  try {
    const run = runner(system, state);
    for (let i = 0; i < 10; i++) run.frame();
    const beforeTrigger = system.getDebug().positions;
    const result = system.triggerEvent('gathering', near);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const venue = venueOf(system);
    assert.ok(venue, 'A successful invitation must have a live venue immediately');
    assert.ok(result.event.invited > 0 && result.event.invited <= 18);
    assert.equal(result.event.arrived, 0);
    assert.deepEqual(
      system.getDebug().positions,
      beforeTrigger,
      'Trigger must not relocate residents',
    );
    for (let i = 0; i < 100; i++) run.frame();
    const paused = system.getLife();
    for (let i = 0; i < 40; i++) run.frame(21, false);
    assert.deepEqual(system.getLife(), paused);
    assert.equal(venueOf(system), venue, 'Walking and paused frames reuse the same venue');
    const initialTravel = new Map(run.traveled);
    let arrivals = 0,
      maxStationary = 0;
    const stationary = new Map<number, number>();
    const present = new Map<number, Walker>();
    let pausedAfterArrival = false;
    let previous = system.getDebug().positions;
    for (let i = 0; i < Math.ceil(result.event.remaining / DT) + 1; i++) {
      const positions = run.frame();
      const event = system.getLife().event;
      if (!event) break;
      arrivals = Math.max(arrivals, event.arrived);
      for (const [id, parked] of present) {
        const current = positions.find((p) => p.id === id)!;
        assert.equal(
          distance(current, parked),
          0,
          'An arrived guest must stay until the event ends',
        );
        assert.equal(current.crossing, false);
      }
      for (let j = 0; j < positions.length; j++) {
        const p = positions[j];
        const frames =
          Math.hypot(p.x - event.x, p.z - event.z) <= 0.6 + EPS &&
          state.tiles[
            Math.floor(p.z + state.size / 2) * state.size + Math.floor(p.x + state.size / 2)
          ].kind === 'park' &&
          distance(p, previous[j]) < EPS &&
          run.traveled.get(p.id)! - initialTravel.get(p.id)! > 0.1
            ? (stationary.get(p.id) ?? 0) + 1
            : 0;
        stationary.set(p.id, frames);
        maxStationary = Math.max(maxStationary, frames);
        if (frames >= 40) present.set(p.id, p);
      }
      if (present.size > 0 && !pausedAfterArrival) {
        const snapshot = system.getLife();
        for (let frame = 0; frame < 40; frame++) run.frame(21, false);
        assert.deepEqual(
          system.getLife(),
          snapshot,
          'Present guests and event time freeze together',
        );
        pausedAfterArrival = true;
      }
      previous = positions;
    }
    assert.ok(
      arrivals > 0,
      'Invitations must become real arrivals at normal walking pace before expiry',
    );
    assert.ok(maxStationary >= 40, 'Arrivals must visibly socialise for at least two seconds');
    assert.ok(present.size > 1, 'Several guests must be physically present together');
    assert.ok(
      new Set([...present.values()].map((p) => `${p.x}:${p.z}`)).size >= 2,
      'Use several existing park nodes when possible',
    );
    assert.equal(system.getLife().event, null);
    assert.equal(venueOf(system), undefined, 'Expiry removes the temporary furniture');
    assert.equal(venue.parent, null);
    assert.equal(venue.children.length, 0);
    assert.ok(system.getLife().cooldownSeconds > 0);
    assert.equal(system.getLife().counts.social, 0);
    assert.ok([...run.traveled.values()].reduce((a, b) => a + b, 0) > 20);
  } finally {
    system.dispose();
  }
});

test('stopEvent releases a real festival crowd onto lawful routes without position changes', () => {
  const { state, system, near } = fixture();
  try {
    const run = runner(system, state);
    assert.equal(system.triggerEvent('festival', near).ok, true);
    for (let i = 0; i < 1800 && system.getLife().event!.arrived === 0; i++) run.frame();
    assert.ok(
      system.getLife().event!.arrived > 0,
      'Festival must receive a physically walking guest',
    );
    const before = system.getDebug().positions;
    system.stopEvent();
    assert.equal(system.getLife().event, null);
    assert.equal(system.getLife().counts.social, 0);
    assert.deepEqual(system.getDebug().positions, before);
    const traveled = [...run.traveled.values()].reduce((a, b) => a + b, 0);
    for (let i = 0; i < 200; i++) run.frame();
    assert.ok(
      [...run.traveled.values()].reduce((a, b) => a + b, 0) > traveled + 1,
      'Residents must resume moving after stop',
    );
  } finally {
    system.dispose();
  }
});

test('employer rebuild clears stale work/event targets without snapping existing residents', () => {
  const { state, system, near } = fixture();
  try {
    const run = runner(system, state);
    for (let i = 0; i < 40; i++) run.frame();
    assert.ok(system.getLife().counts.work > 0);
    assert.equal(system.triggerEvent('gathering', near).ok, true);
    const before = system.getDebug().positions;
    // Same occupancy/active roads, changed semantic use: the work destination
    // must disappear even though no pavement geometry needs changing.
    state.tiles[14 * 40 + 17].kind = 'residential';
    state.revision++;
    system.update(state);
    assert.deepEqual(system.getDebug().positions, before);
    assert.equal(system.getLife().event, null);
    assert.equal(venueOf(system), undefined);
    for (let i = 0; i < 200; i++) {
      run.frame();
      assert.equal(
        system.getLife().counts.work,
        0,
        'Removed employer must not retain a work label',
      );
      assert.equal(system.getLife().counts.social, 0);
    }
    assert.ok(system.getLife().counts.wandering > 0);
  } finally {
    system.dispose();
  }
});

for (const kind of ['gathering', 'festival'] as const)
  test(`${kind} trigger attaches real furniture, with no ring, and stop/dispose release only owned resources`, () => {
    const { system, near } = fixture();
    let sharedDisposed = false,
      disposed = 0;
    const onSharedDispose = () => {
      sharedDisposed = true;
    };
    boxGeometry.addEventListener('dispose', onSharedDispose);
    try {
      assert.equal(system.group.getObjectByName('citizen-event-meeting-point'), undefined);
      assert.equal(system.triggerEvent(kind, near).ok, true);
      const venue = venueOf(system)!;
      assert.ok(venue?.userData.eventVenue.placed);
      assert.ok(
        venue.userData.eventVenue.placements.some(
          (p: { name: string }) => p.name === (kind === 'festival' ? 'stage' : 'lemonade-stand'),
        ),
      );
      const bounds = new THREE.Box3().setFromObject(venue);
      assert.ok(bounds.max.y - bounds.min.y > 0.23, 'The venue includes its full canopy');
      const resources = new Set<THREE.BufferGeometry | THREE.Material>();
      venue.traverse((part) => {
        if (part instanceof THREE.Mesh) {
          assert.notEqual(part.geometry.type, 'TorusGeometry');
          assert.ok(part.geometry.getAttribute('position').count > 0);
          resources.add(part.geometry);
          resources.add(part.material as THREE.Material);
        }
      });
      assert.ok(resources.size > 0);
      for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
      for (let frame = 0; frame < 10; frame++) system.animate(DT, true, 12);
      assert.equal(venueOf(system), venue);
      if (kind === 'gathering') {
        system.stopEvent();
        system.stopEvent();
      } else system.dispose();
      assert.equal(venueOf(system), undefined);
      assert.equal(venue.parent, null);
      assert.equal(venue.children.length, 0);
      assert.equal(disposed, resources.size);
      assert.equal(sharedDisposed, false);
    } finally {
      boxGeometry.removeEventListener('dispose', onSharedDispose);
      if (kind === 'gathering') system.dispose();
    }
  });

test('a crowded live event site returns no-place without guests, venue or cooldown', () => {
  const { state, system, near } = fixture();
  try {
    for (const tile of state.tiles)
      if (tile.kind === 'empty') Object.assign(tile, { kind: 'residential', level: 2 });
    state.tiles[16 * 40 + 14].variation = 4;
    state.revision++;
    system.update(state);
    const before = system.getDebug().positions;
    assert.deepEqual(system.triggerEvent('festival', near), { ok: false, reason: 'no-place' });
    assert.equal(system.getLife().event, null);
    assert.equal(system.getLife().cooldownSeconds, 0);
    assert.equal(system.getLife().counts.social, 0);
    assert.equal(venueOf(system), undefined);
    assert.deepEqual(system.getDebug().positions, before);
  } finally {
    system.dispose();
  }
});

test('local terrain edits remove the venue immediately while unrelated state updates reuse it', () => {
  const { state, system, near } = fixture();
  try {
    assert.equal(system.triggerEvent('festival', near).ok, true);
    const venue = venueOf(system)!;
    state.stats.happiness++;
    state.revision++;
    system.update(state);
    assert.equal(venueOf(system), venue);
    const stage = venue.userData.eventVenue.placements.find(
      (p: { name: string }) => p.name === 'stage',
    );
    state.tiles[stage.tile].elevation += 0.5;
    state.revision++;
    system.update(state);
    assert.equal(system.getLife().event, null);
    assert.equal(venueOf(system), undefined);
    assert.equal(venue.children.length, 0);
  } finally {
    system.dispose();
  }
});

for (const replacement of ['reset', 'new-map'] as const)
  test(`${replacement} clears temporary event furniture without an animation frame`, () => {
    const { state, system, near } = fixture();
    try {
      assert.equal(system.triggerEvent('festival', near).ok, true);
      const venue = venueOf(system)!;
      const next = structuredClone(state);
      if (replacement === 'new-map') next.seed++;
      system.update(next, replacement === 'reset');
      assert.equal(system.getLife().event, null);
      assert.equal(venueOf(system), undefined);
      assert.equal(venue.children.length, 0);
      assert.equal(venue.parent, null);
    } finally {
      system.dispose();
    }
  });
