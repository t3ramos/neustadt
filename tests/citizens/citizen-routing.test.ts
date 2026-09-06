import assert from 'node:assert/strict';
import test from 'node:test';
import { createCity } from '../../src/simulation/city-simulation.ts';
import {
  createPedestrianGraph,
  PARK_PATH_END,
  SIDEWALK_OFFSET,
  type PedestrianGraph,
  type PedestrianNode,
} from '../../src/citizens/routing.ts';
import type { CityState, TileKind } from '../../src/domain/types.ts';

function fixture(): CityState {
  const state = createCity(42, true, 40);
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.level = 0;
    tile.elevation = 1;
    tile.fire = 0;
    tile.anchor = -1;
  }
  return state;
}
function put(
  state: CityState,
  x: number,
  z: number,
  kind: TileKind = 'road',
  elevation = 1,
): number {
  const index = z * state.size + x;
  Object.assign(state.tiles[index], { kind, elevation });
  return index;
}
function graph(state: CityState): PedestrianGraph {
  return createPedestrianGraph(
    state,
    state.tiles.flatMap((t, i) => (t.kind === 'road' || t.kind === 'park' ? [i] : [])),
  );
}
function close(a: number, b: number): void {
  assert.ok(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);
}
function connected(g: PedestrianGraph, start: number): Set<number> {
  const seen = new Set([start]),
    queue = [start];
  for (const id of queue)
    for (const edge of g.neighbors(id))
      if (!seen.has(edge.node)) {
        seen.add(edge.node);
        queue.push(edge.node);
      }
  return seen;
}
function roadAsphalt(state: CityState, x: number, z: number): boolean {
  const gx = Math.floor(x + state.size / 2),
    gz = Math.floor(z + state.size / 2);
  if (gx < 0 || gz < 0 || gx >= state.size || gz >= state.size) return false;
  const tile = state.tiles[gz * state.size + gx];
  if (tile.kind !== 'road') return false;
  const dx = x - (gx + 0.5 - state.size / 2),
    dz = z - (gz + 0.5 - state.size / 2);
  const links = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ].map(([ox, oz]) => {
    const nx = gx + ox,
      nz = gz + oz;
    return (
      nx >= 0 &&
      nz >= 0 &&
      nx < state.size &&
      nz < state.size &&
      ['road', 'airport', 'seaport'].includes(state.tiles[nz * state.size + nx].kind)
    );
  });
  if (!links.some(Boolean)) {
    links[0] = true;
    links[2] = true;
  }
  return (
    (Math.abs(dx) < 0.335 && Math.abs(dz) < 0.335) ||
    (Math.abs(dx) < 0.335 && (dz < 0 ? links[0] : links[2])) ||
    (Math.abs(dz) < 0.335 && (dx < 0 ? links[3] : links[1]))
  );
}
function checkEdges(state: CityState, g: PedestrianGraph): void {
  for (const a of g.nodes)
    for (const edge of g.neighbors(a.id)) {
      const b = g.byId.get(edge.node)!;
      assert.ok(b, 'Every edge must reference a real node');
      assert.ok(
        g.neighbors(b.id).some((back) => back.node === a.id && back.crosswalk === edge.crosswalk),
      );
      assert.ok(Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.z - b.z) < 1e-9, 'No diagonal shortcut');
      if (!edge.crosswalk)
        for (let sample = 0; sample <= 30; sample++) {
          const t = sample / 30;
          assert.equal(
            roadAsphalt(state, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t),
            false,
            'Unmarked path must stay off asphalt',
          );
        }
    }
}

test('road corners have stable IDs and world positions on the pavement centreline', () => {
  const state = fixture(),
    tile = put(state, 10, 10),
    g = graph(state);
  assert.equal(g.nodes.length, 4);
  for (let slot = 0; slot < 4; slot++) {
    const p = g.byId.get(tile * 8 + slot)!;
    assert.equal(p.tile, tile);
    close(Math.abs(p.x + 9.5), SIDEWALK_OFFSET);
    close(Math.abs(p.z + 9.5), SIDEWALK_OFFSET);
  }
  assert.deepEqual(g.neighbors(-99), []);
});

test('a long straight road joins the same pavement side over every tile seam', () => {
  const state = fixture();
  for (let x = 3; x <= 25; x++) put(state, x, 12);
  const g = graph(state);
  checkEdges(state, g);
  const middle = 12 * state.size + 10;
  for (const slot of [0, 1])
    for (const edge of g.neighbors(middle * 8 + slot)) {
      close(g.byId.get(edge.node)!.z, 12.5 - state.size / 2 - SIDEWALK_OFFSET);
    }
  const left = g.byId.get(middle * 8 + 1)!,
    right = g.byId.get((middle + 1) * 8)!;
  close(right.x - left.x, 0.19);
  assert.ok(g.neighbors(left.id).some((edge) => edge.node === right.id && !edge.crosswalk));
  // Follow the northern pavement through 20 tiles without swapping sides.
  let previous = middle * 8,
    current = middle * 8 + 1;
  for (let i = 0; i < 20; i++) {
    const candidates = g.neighbors(current).filter((edge) => edge.node !== previous);
    assert.equal(candidates.length, 1);
    const next = candidates[0].node;
    close(g.byId.get(next)!.z, left.z);
    previous = current;
    current = next;
  }
});

test('an L bend preserves the inside corner and outer pavement without a diagonal road crossing', () => {
  const state = fixture(),
    bend = put(state, 10, 10);
  put(state, 10, 9);
  put(state, 10, 8);
  put(state, 11, 10);
  put(state, 12, 10);
  const g = graph(state);
  checkEdges(state, g);
  const local = (slot: number) =>
    g
      .neighbors(bend * 8 + slot)
      .filter((edge) => g.byId.get(edge.node)!.tile === bend)
      .map((edge) => edge.node % 8);
  assert.deepEqual(local(1), [], 'Inside NE corner joins only adjacent-tile corners');
  assert.deepEqual(local(3).sort(), [0, 2], 'Outer SW corner turns around the pavement');
  assert.equal(
    g.nodes.flatMap((n) => [...g.neighbors(n.id)]).some((e) => e.crosswalk),
    false,
  );
  assert.equal(
    connected(g, bend * 8).size,
    g.nodes.length,
    'Dead-end endcaps join the two pavements safely',
  );
});

test('T junctions cross asphalt only inside the three marked crossing bands', () => {
  const state = fixture(),
    junction = put(state, 10, 10);
  put(state, 10, 9);
  put(state, 11, 10);
  put(state, 9, 10);
  const g = graph(state);
  checkEdges(state, g);
  const crossings: [PedestrianNode, PedestrianNode][] = [];
  for (const a of g.nodes)
    for (const edge of g.neighbors(a.id))
      if (edge.crosswalk && a.id < edge.node) {
        const b = g.byId.get(edge.node)!;
        crossings.push([a, b]);
        assert.equal(a.tile, junction);
        assert.equal(b.tile, junction);
        const cx = 10.5 - state.size / 2,
          cz = cx;
        const band = a.x === b.x ? Math.abs(a.x - cx) : Math.abs(a.z - cz);
        assert.ok(band >= 0.3 && band <= 0.42, 'Crossing lies in the visible .36 ± .06 band');
      }
  assert.equal(crossings.length, 3);
});

test('isolated roads retain rendered north/south arms and cannot randomly switch pavement sides', () => {
  const state = fixture(),
    index = put(state, 10, 10),
    g = graph(state);
  checkEdges(state, g);
  assert.deepEqual(
    g.neighbors(index * 8).map((e) => e.node),
    [index * 8 + 3],
  );
  assert.deepEqual(
    g.neighbors(index * 8 + 1).map((e) => e.node),
    [index * 8 + 2],
  );
  assert.equal(connected(g, index * 8).has(index * 8 + 1), false);
});

test('parks follow their cross paths and enter roads through a perpendicular pavement port', () => {
  const state = fixture(),
    road = put(state, 10, 10),
    park = put(state, 11, 10, 'park'),
    otherPark = put(state, 12, 10, 'park');
  const g = graph(state);
  checkEdges(state, g);
  const port = g.byId.get(road * 8 + 5)!;
  assert.ok(port);
  close(port.x, 10.5 - state.size / 2 + SIDEWALK_OFFSET);
  assert.deepEqual(
    g
      .neighbors(port.id)
      .map((e) => e.node)
      .sort((a, b) => a - b),
    [road * 8 + 1, road * 8 + 2, park * 8 + 7],
  );
  const parkCenter = g.byId.get(park * 8)!;
  assert.equal(g.neighbors(parkCenter.id).length, 4);
  for (const edge of g.neighbors(parkCenter.id)) {
    const end = g.byId.get(edge.node)!;
    close(Math.hypot(end.x - parkCenter.x, end.z - parkCenter.z), PARK_PATH_END);
  }
  assert.ok(connected(g, parkCenter.id).has(otherPark * 8));
  assert.ok(
    !connected(g, parkCenter.id).has(road * 8),
    'Park entrance must not jump across the isolated road',
  );
});

test('a park cannot connect through the unmarked asphalt end of an isolated road', () => {
  const state = fixture(),
    road = put(state, 10, 10),
    park = put(state, 10, 9, 'park'),
    g = graph(state);
  assert.equal(g.byId.has(road * 8 + 4), false);
  assert.equal(connected(g, park * 8).has(road * 8), false);
  checkEdges(state, g);
});

test('active bounds preserve the rendered arms of roads outside the crowd area', () => {
  const state = fixture(),
    road = put(state, 10, 10);
  put(state, 9, 10);
  put(state, 11, 10);
  const g = createPedestrianGraph(state, [road, road]);
  assert.equal(g.nodes.length, 4);
  checkEdges(state, g);
  assert.deepEqual(
    g.neighbors(road * 8).map((e) => e.node),
    [road * 8 + 1],
  );
  assert.equal(connected(g, road * 8).has(road * 8 + 3), false);
});

test('water, fire, cliffs and row wrapping cannot create traversable seams', () => {
  const state = fixture(),
    low = put(state, 10, 10),
    high = put(state, 11, 10, 'road', 2);
  const drowned = put(state, 12, 10, 'road', -0.2),
    burned = put(state, 10, 9);
  state.tiles[burned].fire = 1;
  const water = put(state, 11, 9, 'water');
  const rowEnd = put(state, 39, 15),
    rowStart = put(state, 0, 16);
  const g = createPedestrianGraph(state, [
    low,
    high,
    drowned,
    burned,
    water,
    rowEnd,
    rowStart,
    -1,
    0.5,
    999999,
  ]);
  assert.equal(g.nodes.length, 16);
  for (const index of [drowned, burned, water])
    assert.equal(
      g.nodes.some((n) => n.tile === index),
      false,
    );
  assert.equal(connected(g, low * 8).has(high * 8), false);
  assert.equal(connected(g, rowEnd * 8).has(rowStart * 8), false);
  state.tiles[high].elevation = 1.75;
  const reachable = graph(state);
  assert.ok(reachable.neighbors(low * 8 + 1).some((e) => e.node === high * 8));
});

test('nearest lookup is exact, stable on ties, and safe for empty or invalid queries', () => {
  const state = fixture();
  for (let z = 2; z < 35; z += 4)
    for (let x = 2; x < 35; x += 3) put(state, x, z, (x + z) % 2 ? 'road' : 'park');
  const g = graph(state);
  for (let i = 0; i < 150; i++) {
    const x = Math.sin(i * 1.1) * 30,
      z = Math.cos(i * 2.7) * 30;
    const actual = g.byId.get(g.nearest(x, z)!)!;
    const minimum = Math.min(...g.nodes.map((n) => (n.x - x) ** 2 + (n.z - z) ** 2));
    close((actual.x - x) ** 2 + (actual.z - z) ** 2, minimum);
  }
  const isolated = fixture(),
    index = put(isolated, 10, 10),
    one = graph(isolated),
    preferred = index * 8 + 3;
  assert.equal(one.nearest(-9.5, -9.5), index * 8);
  assert.equal(one.nearest(-9.5, -9.5, preferred), preferred);
  assert.equal(
    one.nearest(-9.5 - SIDEWALK_OFFSET, -9.5 - SIDEWALK_OFFSET, preferred),
    index * 8,
    'Preference cannot override a closer point',
  );
  assert.equal(g.nearest(NaN, 0), null);
  assert.equal(g.nearest(0, Infinity), null);
  assert.equal(createPedestrianGraph(state, []).nearest(0, 0), null);
  assert.deepEqual(
    createPedestrianGraph(state, new Set(g.nodes.map((n) => n.tile).reverse())).nodes,
    g.nodes,
  );
});
