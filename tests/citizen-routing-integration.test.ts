import assert from 'node:assert/strict';
import test from 'node:test';
import { createCitizens, type CitizenSystem, type CitizenVehicleSweep } from '../src/citizens.ts';
import { SIDEWALK_OFFSET } from '../src/citizen-routing.ts';
import { applyCitizenIncident, createCity } from '../src/simulation.ts';
import type { CitizenIncident, CityState } from '../src/types.ts';

type Walker = ReturnType<CitizenSystem['getDebug']>['positions'][number];
type Incident = Omit<CitizenIncident, 'id' | 'month'>;
const FRAME = .05;

function city(roads: readonly (readonly [number, number])[]): CityState {
  const state = createCity(91, true, 40);
  for (const tile of state.tiles) { tile.kind = 'empty'; tile.elevation = 1; tile.anchor = -1; tile.level = 0; tile.fire = 0; }
  for (const [x, z] of roads) state.tiles[z * state.size + x].kind = 'road';
  for (const [x, z] of roads) {
    const home = [[x + 1, z], [x, z + 1], [x - 1, z], [x, z - 1]].map(([gx, gz]) => state.tiles[gz * state.size + gx]).find(t => t?.kind === 'empty');
    if (home) { home.kind = 'residential'; home.level = 1; }
  }
  state.stats.population = 100; state.revision++;
  return state;
}

function positionOnMap(state: CityState, point: Pick<Walker, 'x' | 'z'>) {
  const x = Math.floor(point.x + state.size / 2), z = Math.floor(point.z + state.size / 2);
  const tile = state.tiles[z * state.size + x];
  assert.ok(tile, 'Walking remains within the map');
  return { tile, x, z, dx: point.x - (x + .5 - state.size / 2), dz: point.z - (z + .5 - state.size / 2) };
}

function onAsphalt(state: CityState, point: Pick<Walker, 'x' | 'z'>): boolean {
  const { tile, x, z, dx, dz } = positionOnMap(state, point);
  if (tile.kind !== 'road') return false;
  const links = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([ox, oz]) => {
    const nx = x + ox, nz = z + oz;
    return nx >= 0 && nz >= 0 && nx < state.size && nz < state.size && ['road', 'airport', 'seaport'].includes(state.tiles[nz * state.size + nx].kind);
  });
  if (!links.some(Boolean)) { links[0] = true; links[2] = true; }
  return (Math.abs(dx) < .335 && Math.abs(dz) < .335) ||
    (Math.abs(dx) < .335 && (dz < 0 ? links[0] : links[2])) ||
    (Math.abs(dz) < .335 && (dx < 0 ? links[3] : links[1]));
}

function verifyFrame(state: CityState, before: readonly Walker[], after: readonly Walker[], junction?: readonly [number, number]): number {
  let crossings = 0;
  const previous = new Map(before.map(p => [p.id, p]));
  for (const walker of after) {
    assert.equal(walker.state, 'walking');
    const old = previous.get(walker.id);
    if (old) {
      const dx = Math.abs(walker.x - old.x), dz = Math.abs(walker.z - old.z);
      assert.ok(dx < 1e-9 || dz < 1e-9, 'A walker must turn at the vertex rather than jump diagonally');
      const maximumStep = .16 * FRAME * (walker.crossing || old.crossing ? 1.6 : 1);
      assert.ok(Math.hypot(dx, dz) <= maximumStep + .00001, 'Walking remains bounded by normal or brisk crossing pace');
    }
    const point = positionOnMap(state, walker);
    assert.equal(point.tile.kind, 'road');
    if (walker.crossing) {
      assert.ok(junction, 'Unmarked roads must never flag an asphalt crossing');
      assert.equal(point.x, junction[0]); assert.equal(point.z, junction[1]);
      assert.ok(Math.abs(Math.abs(point.dx) - SIDEWALK_OFFSET) < 1e-9 || Math.abs(Math.abs(point.dz) - SIDEWALK_OFFSET) < 1e-9, 'Crossing stays inside its painted edge band');
    }
    if (onAsphalt(state, walker)) {
      assert.equal(walker.crossing, true, 'Asphalt traversal requires an explicitly marked graph crossing');
      crossings++;
    } else {
      assert.ok(Math.abs(Math.abs(point.dx) - SIDEWALK_OFFSET) < 1e-9 || Math.abs(Math.abs(point.dz) - SIDEWALK_OFFSET) < 1e-9, 'Walkers remain on the .405 pavement line');
    }
  }
  return crossings;
}

test('actual walkers keep the same straight-road pavement and take no diagonal shortcuts', () => {
  const state = city(Array.from({ length: 9 }, (_, i) => [i + 6, 10] as const)), system = createCitizens(state);
  try {
    let before = system.getDebug().positions, movement = 0;
    assert.equal(before.length, 24); verifyFrame(state, [], before);
    for (let frame = 0; frame < 1000; frame++) {
      system.animate(FRAME, true);
      const after = system.getDebug().positions; verifyFrame(state, before, after);
      for (let i = 0; i < after.length; i++) movement += Math.hypot(after[i].x - before[i].x, after[i].z - before[i].z);
      before = after;
    }
    assert.ok(movement > 100, 'Crowds must actually walk, rather than merely remain at valid spawn points');
  } finally { system.dispose(); }
});

test('actual walkers turn around an L junction on the inside and outside pavement', () => {
  const roads: [number, number][] = [[10, 10], [10, 9], [10, 8], [10, 7], [11, 10], [12, 10], [13, 10]];
  const state = city(roads), system = createCitizens(state);
  try {
    let before = system.getDebug().positions, bendVisits = 0;
    const seenDirections = new Set<string>();
    const trips = new Map<number, { arm: 'north' | 'east'; route: 'inside' | 'outside' | null }>();
    const completedRoutes = new Set<string>();
    for (let frame = 0; frame < 1200; frame++) {
      system.animate(FRAME, true);
      const after = system.getDebug().positions; verifyFrame(state, before, after);
      for (let i = 0; i < after.length; i++) {
        const { x, z, dx, dz } = positionOnMap(state, after[i]);
        if (x === 10 && z === 10) {
          bendVisits++;
          if (Math.abs(after[i].x - before[i].x) > 1e-6) seenDirections.add('horizontal');
          if (Math.abs(after[i].z - before[i].z) > 1e-6) seenDirections.add('vertical');
          const trip = trips.get(after[i].id);
          if (trip) trip.route = dx > 0 && dz < 0 ? 'inside' : 'outside';
        } else {
          const arm = x === 10 && z < 10 ? 'north' : 'east';
          const trip = trips.get(after[i].id);
          if (trip && trip.arm !== arm && trip.route) completedRoutes.add(trip.route);
          trips.set(after[i].id, { arm, route: null });
        }
      }
      before = after;
    }
    assert.ok(bendVisits > 100); assert.deepEqual([...seenDirections].sort(), ['horizontal', 'vertical']);
    assert.deepEqual([...completedRoutes].sort(), ['inside', 'outside'], 'Residents individually complete both pavement turns between the north and east arms');
  } finally { system.dispose(); }
});

test('actual T-junction crossings use only painted bands and expose crossing=true', () => {
  const roads: [number, number][] = [[10, 10], [10, 9], [10, 8], [10, 7], [9, 10], [8, 10], [7, 10], [11, 10], [12, 10], [13, 10]];
  const state = city(roads), system = createCitizens(state);
  try {
    let before = system.getDebug().positions, asphaltFrames = 0;
    for (let frame = 0; frame < 1600; frame++) {
      system.animate(FRAME, true);
      const after = system.getDebug().positions; asphaltFrames += verifyFrame(state, before, after, [10, 10]); before = after;
    }
    assert.ok(asphaltFrames > 100, 'Residents must actually traverse the marked junction during the run');
  } finally { system.dispose(); }
});

test('repeated traffic-only vehicle sweeps never kill, throw or remove waiting pedestrians', () => {
  const state = city([[10, 10], [10, 9], [11, 10], [9, 10]]), incidents: Incident[] = [];
  const system = createCitizens(state, incident => { incidents.push(incident); applyCitizenIncident(state, incident); });
  try {
    const originalPopulation = state.stats.population, originalCount = system.getDebug().count;
    // The route traverses all three arms. Sweeps are intentionally repeated to
    // exercise the public traffic path instead of the driver's impact behavior.
    const center = 10.5 - state.size / 2;
    const sweeps: CitizenVehicleSweep[] = [
      { previous: { x: center - 2, y: 1.04, z: center }, current: { x: center + 2, y: 1.04, z: center }, yaw: Math.PI / 2, width: .18, length: .34, velocity: { x: 3, y: 0, z: 0 }, vehicleId: 17, trafficOnly: true },
      { previous: { x: center, y: 1.04, z: center - 2 }, current: { x: center, y: 1.04, z: center + .2 }, yaw: 0, width: .18, length: .34, velocity: { x: 0, y: 0, z: 3 }, vehicleId: 18, trafficOnly: true },
    ];
    for (let frame = 0; frame < 300; frame++) {
      for (const sweep of sweeps) system.sweepVehicleImpact(sweep);
      system.animate(FRAME, true);
      assert.equal(system.getDebug().ragdolls, 0);
    }
    assert.equal(incidents.length, 0); assert.equal(state.stats.population, originalPopulation);
    assert.equal(system.getDebug().count, originalCount); assert.equal(system.getDebug().recovering, 0);
  } finally { system.dispose(); }
});

test('a crossing walker yields on the curb for approaching traffic, then resumes after it clears', () => {
  const state = city([[10, 10], [10, 9], [11, 10], [9, 10]]), incidents: Incident[] = [];
  const system = createCitizens(state, incident => { incidents.push(incident); applyCitizenIncident(state, incident); });
  try {
    let corner: Walker | undefined;
    for (let frame = 0; frame < 1400 && !corner; frame++) {
      system.animate(FRAME, true);
      corner = system.getDebug().positions.find(p => {
        if (!p.crossing) return false;
        const { dx, dz } = positionOnMap(state, p);
        return Math.abs(Math.abs(dx) - SIDEWALK_OFFSET) < 1e-9 && Math.abs(Math.abs(dz) - SIDEWALK_OFFSET) < 1e-9;
      });
    }
    assert.ok(corner, 'A real walker must reach the beginning of a crossing');
    // One ordinary frame reveals the selected crossing direction while the
    // walker is still safely on the .07-wide curb before the asphalt begins.
    system.animate(FRAME, true);
    const start = system.getDebug().positions.find(p => p.id === corner.id)!;
    const horizontal = Math.abs(start.x - corner.x) > 1e-6;
    assert.ok(horizontal || Math.abs(start.z - corner.z) > 1e-6);
    assert.equal(onAsphalt(state, start), false);
    const center = 10.5 - state.size / 2;
    const current = { x: horizontal ? center : start.x - 1.2, y: 1.04, z: horizontal ? start.z - 1.2 : center };
    const event: CitizenVehicleSweep = {
      previous: { x: current.x - (horizontal ? 0 : .2), y: current.y, z: current.z - (horizontal ? .2 : 0) }, current,
      yaw: horizontal ? 0 : Math.PI / 2, width: .18, length: .34,
      velocity: { x: horizontal ? 0 : 3, y: 0, z: horizontal ? 3 : 0 }, vehicleId: 33, trafficOnly: true,
    };
    const population = state.stats.population;
    for (let frame = 0; frame < 20; frame++) {
      system.sweepVehicleImpact(event); system.animate(FRAME, true);
      const waiting = system.getDebug().positions.find(p => p.id === start.id)!;
      assert.ok(Math.hypot(waiting.x - start.x, waiting.z - start.z) < 1e-9, 'Approaching cars hold the walker at the curb, before an overlap');
      assert.equal(onAsphalt(state, waiting), false); assert.equal(waiting.state, 'walking');
    }
    assert.equal(incidents.length, 0); assert.equal(state.stats.population, population);
    for (let frame = 0; frame < 60; frame++) system.animate(FRAME, true);
    const resumed = system.getDebug().positions.find(p => p.id === start.id)!;
    assert.ok(Math.hypot(resumed.x - start.x, resumed.z - start.z) > .1, 'Once traffic clears, the walker resumes crossing');
    assert.equal(incidents.length, 0); assert.equal(system.getDebug().ragdolls, 0);
  } finally { system.dispose(); }
});
