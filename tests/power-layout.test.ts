import assert from 'node:assert/strict';
import test from 'node:test';
import { getPowerLayout, powerLayoutSignature, type PowerLayout } from '../src/power-layout.ts';
import { createCity, getFootprint, recalculate, TOOL_DEFS } from '../src/simulation.ts';
import { sampleGroundHeight } from '../src/terrain-graphics.ts';
import { sampleRoadHeight } from '../src/road-graphics.ts';
import type { CityState, Tile, TileKind } from '../src/types.ts';

function city(): CityState {
  const state = createCity(741, true, 40);
  for (const tile of state.tiles) { tile.elevation = 0; tile.kind = 'empty'; }
  return state;
}
const at = (state: CityState, x: number, z: number) => state.tiles[z * state.size + x];
const idOf = (state: CityState, tile: Tile) => tile.z * state.size + tile.x;
function wire(state: CityState, x: number, z: number, kind: TileKind = 'empty'): Tile {
  const tile = at(state, x, z);
  tile.kind = kind; tile.hasPowerLine = true;
  return tile;
}
function building(state: CityState, x: number, z: number, kind: TileKind = 'residential', rotation: 0 | 1 | 2 | 3 = 0): Tile {
  const root = at(state, x, z), size = TOOL_DEFS[kind]?.footprint;
  const [width, depth] = size ? rotation % 2 ? [size[1], size[0]] : size : [1, 1];
  for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) {
    const tile = at(state, x + dx, z + dz);
    tile.kind = kind; tile.level = 1; tile.rotation = rotation;
    tile.anchor = size ? idOf(state, root) : -1;
  }
  return root;
}
function validateSpans(state: CityState, layout: PowerLayout): void {
  const poles = new Set(layout.poles.map(pole => pole.id));
  const visited = new Set<string>();
  for (const span of layout.spans) {
    assert.ok(poles.has(span.from) && poles.has(span.to), 'Both span endpoints must be real poles');
    assert.equal(span.path[0], span.from);
    assert.equal(span.path.at(-1), span.to);
    assert.ok(span.path.length >= 2 && span.path.length <= 4, 'Straight spans are bounded to three cells');
    for (let i = 0; i < span.path.length; i++) {
      const tile = state.tiles[span.path[i]];
      assert.ok(tile.hasPowerLine);
      assert.equal(tile.fire, 0);
      assert.ok(!TOOL_DEFS[tile.kind]?.footprint && !(['residential', 'commercial', 'industrial'].includes(tile.kind) && tile.level > 0), 'No overhead corridor passes through a structure');
      if (i === 0) continue;
      const previous = state.tiles[span.path[i - 1]];
      assert.equal(Math.abs(previous.x - tile.x) + Math.abs(previous.z - tile.z), 1, 'No gap or diagonal is skipped');
      const a = span.path[i - 1], b = span.path[i], edge = a < b ? `${a}:${b}` : `${b}:${a}`;
      assert.ok(!visited.has(edge), 'An edge must not produce two coincident wires');
      visited.add(edge);
    }
  }
}

test('line graph compresses straight runs and preserves every corner, branch, ring and endpoint', () => {
  const state = city();
  for (let x = 4; x <= 16; x++) wire(state, x, 10);
  for (let z = 5; z <= 15; z++) wire(state, 10, z);
  for (let x = 20; x <= 26; x++) { wire(state, x, 20); wire(state, x, 26); }
  for (let z = 20; z <= 26; z++) { wire(state, 20, z); wire(state, 26, z); }
  wire(state, 30, 30);
  const layout = getPowerLayout(state);
  validateSpans(state, layout);
  assert.ok(layout.poles.some(pole => pole.x === 10 && pole.z === 10 && pole.directions.length === 4));
  assert.ok(layout.poles.some(pole => pole.x === 30 && pole.z === 30 && pole.directions.length === 0));
  const edges = layout.spans.reduce((sum, span) => sum + span.path.length - 1, 0);
  assert.equal(edges, 12 + 10 + 24, 'Every explicit orthogonal wire edge is represented exactly once');
  assert.ok(layout.poles.length < state.tiles.filter(tile => tile.hasPowerLine).length);
});

test('removed wire cells and developed building footprints break overhead spans without floating ends', () => {
  const state = city();
  for (let x = 3; x <= 18; x++) wire(state, x, 10);
  at(state, 6, 10).hasPowerLine = false;
  building(state, 10, 10, 'police');
  const layout = getPowerLayout(state);
  validateSpans(state, layout);
  assert.ok(layout.poles.some(pole => pole.x === 5 && pole.z === 10));
  assert.ok(layout.poles.some(pole => pole.x === 7 && pole.z === 10));
  assert.ok(!layout.poles.some(pole => pole.x >= 10 && pole.x <= 11 && pole.z === 10));
  assert.ok(!layout.spans.some(span => span.path.includes(10 * state.size + 6)));
});

test('live source and developed lots get one local drop, while empty zoning and dead components do not', () => {
  const state = city(), source = building(state, 2, 2, 'power');
  for (let x = 6; x <= 15; x++) wire(state, x, 4);
  const home = building(state, 10, 6);
  const emptyZone = at(state, 13, 6); emptyZone.kind = 'commercial';
  const deadHome = building(state, 25, 20); wire(state, 25, 18);
  recalculate(state);
  assert.ok(home.powered);
  assert.equal(deadHome.powered, false);
  const layout = getPowerLayout(state), ids = layout.services.map(service => service.building);
  assert.ok(ids.includes(idOf(state, source)), 'The generating facility exports to the wired network');
  assert.ok(ids.includes(idOf(state, home)));
  assert.ok(!ids.includes(idOf(state, emptyZone)));
  assert.ok(!ids.includes(idOf(state, deadHome)));
  assert.equal(new Set(ids).size, ids.length, 'Footprint followers must never create duplicate service cables');
  assert.ok(layout.services.every(service => layout.poles.some(pole => pole.id === service.pole)));
});

test('service uses the highest-supply component selected by simulation, not a closer dead wire', () => {
  const state = city();
  building(state, 2, 2, 'wind');
  for (let x = 4; x <= 11; x++) wire(state, x, 3);
  const home = building(state, 11, 5);
  const dead = wire(state, 12, 5);
  recalculate(state);
  assert.ok(home.powered);
  const service = getPowerLayout(state).services.find(item => item.building === idOf(state, home));
  assert.ok(service);
  assert.notEqual(service.pole, idOf(state, dead));
  assert.equal(state.tiles[service.pole].z, 3);
});

test('source destruction and conductor fires remove false service connections immediately', () => {
  const state = city(), source = building(state, 2, 2, 'wind');
  for (let x = 4; x <= 14; x++) wire(state, x, 3);
  const home = building(state, 14, 5);
  recalculate(state);
  assert.ok(getPowerLayout(state).services.some(service => service.building === idOf(state, home)));
  at(state, 8, 3).fire = 1;
  recalculate(state);
  assert.equal(home.powered, false);
  const broken = getPowerLayout(state);
  validateSpans(state, broken);
  assert.ok(!broken.services.some(service => service.building === idOf(state, home)));
  at(state, 8, 3).fire = 0;
  source.fire = 50;
  recalculate(state);
  assert.equal(getPowerLayout(state).services.length, 0, 'A burning plant contributes no network supply');
});

test('back-row buildings keep simulated electricity but do not get cables through a front building', () => {
  const state = city();
  building(state, 2, 2, 'wind');
  for (let x = 4; x <= 14; x++) wire(state, x, 3);
  const front = building(state, 11, 4), back = building(state, 11, 5);
  recalculate(state);
  assert.ok(front.powered && back.powered, 'Developed buildings really conduct through each other');
  const layout = getPowerLayout(state);
  assert.ok(layout.services.some(service => service.building === idOf(state, front)));
  assert.ok(!layout.services.some(service => service.building === idOf(state, back)), 'No visual cable should cut through the front roof');
});

test('drop obstruction uses the physical curb pole position instead of the center of the road', () => {
  const state = city();
  building(state, 3, 5, 'wind');
  wire(state, 5, 5, 'road');
  const destination = building(state, 6, 4);
  const blockingLot = building(state, 6, 5);
  recalculate(state);
  assert.ok(destination.powered);
  const blocked = getPowerLayout(state);
  assert.ok(!blocked.services.some(service => service.building === idOf(state, destination)), 'The actual +0.86 curb ray crosses the southeast neighbor');
  blockingLot.kind = 'empty'; blockingLot.level = 0;
  recalculate(state);
  const unblocked = getPowerLayout(state).services.find(service => service.building === idOf(state, destination));
  assert.ok(unblocked);
  assert.equal(unblocked.targetZ, 4.95, 'The curb pole sits south of the destination and uses its southern lot edge');
});

test('all large facilities and rotations use a single nearest footprint-edge terminal', () => {
  const kinds = Object.entries(TOOL_DEFS).filter(([, definition]) => definition.footprint).map(([kind]) => kind as TileKind);
  for (const kind of kinds) for (const rotation of [0, 1, 2, 3] as const) {
    const state = city(), facility = building(state, 12, 12, kind, rotation);
    const footprint = getFootprint(state, facility);
    const maxX = Math.max(...footprint.map(point => point.x)), maxZ = Math.max(...footprint.map(point => point.z));
    // Attach at the far corner, deliberately farther than two cells from the anchor for big lots.
    const lineX = maxX + 1, lineZ = maxZ;
    wire(state, lineX, lineZ);
    building(state, lineX + 1, lineZ, 'wind');
    recalculate(state);
    const layout = getPowerLayout(state);
    const services = layout.services.filter(service => service.building === idOf(state, facility));
    assert.equal(services.length, 1, `${kind}, rotation ${rotation}: one anchor service`);
    const service = services[0];
    assert.equal(service.targetX, maxX + .95);
    assert.equal(service.targetZ, maxZ + .5);
    assert.equal(service.elevation, facility.elevation);
    assert.ok(service.targetX >= facility.x && service.targetX < maxX + 1);
    assert.ok(service.targetZ >= facility.z && service.targetZ < maxZ + 1);
  }
});

test('sources export to their own component rather than a stronger disconnected nearby network', () => {
  const state = city(), wind = building(state, 8, 8, 'wind');
  const ownWire = wire(state, 10, 8);
  building(state, 2, 8, 'power');
  wire(state, 6, 8);
  recalculate(state);
  const service = getPowerLayout(state).services.find(item => item.building === idOf(state, wind));
  assert.ok(service);
  assert.equal(service.pole, idOf(state, ownWire));
});

test('mast foundations use real hilly transport and terrain surfaces', () => {
  const state = city();
  for (const tile of state.tiles) tile.elevation = (tile.x % 4) * .5;
  for (let x = 5; x <= 12; x++) wire(state, x, 10, 'road');
  wire(state, 20, 20);
  const bridge = wire(state, 25, 25, 'road'); bridge.elevation = -2;
  const layout = getPowerLayout(state);
  for (const pole of layout.poles) {
    const tile = state.tiles[pole.id], offset = tile.kind === 'road' ? .86 : .5;
    const x = pole.x + offset - state.size / 2, z = pole.z + offset - state.size / 2;
    assert.equal(pole.elevation, tile.kind === 'road' ? sampleRoadHeight(state, x, z) : sampleGroundHeight(state, x, z));
  }
  assert.equal(layout.poles.find(pole => pole.id === idOf(state, bridge))!.elevation, 0);
});

test('layout cache ignores time and money but tracks supply, development, fire, orientation and neighboring terrain', () => {
  const state = city();
  building(state, 2, 2, 'wind');
  const line = wire(state, 4, 3), home = building(state, 6, 3);
  recalculate(state);
  let signature = powerLayoutSignature(state);
  state.money += 100; state.month++; state.revision++; state.settings.timeOfDay += 1;
  assert.equal(powerLayoutSignature(state), signature);
  for (const mutate of [
    () => { home.level++; },
    () => { home.powered = !home.powered; },
    () => { home.fire = 1; },
    () => { home.rotation = 1; },
    () => { line.hasPowerLine = false; },
    () => { line.hasPowerLine = true; },
    () => { at(state, 5, 4).elevation += .5; },
    () => { at(state, 2, 2).kind = 'solar'; },
  ]) {
    mutate();
    const next = powerLayoutSignature(state);
    assert.notEqual(next, signature);
    signature = next;
  }
});
