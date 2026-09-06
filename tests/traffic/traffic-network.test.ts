import { planExternalMovement } from '../../src/traffic/network.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approachKey,
  buildRoadNetwork,
  planJunctionMovement,
  roadPointKey,
  type RoadNetwork,
} from '../../src/traffic/network.ts';
import type { Point, Tile } from '../../src/domain/types.ts';
import { interiorRoadNetwork } from '../fixtures/traffic-fixtures';

function tile([x, z]: [number, number], kind: Tile['kind'] = 'road'): Tile {
  return {
    x,
    z,
    kind,
    level: 0,
    variation: 0,
    powered: false,
    watered: false,
    connected: false,
    pollution: 0,
    landValue: 0,
    traffic: 0,
    fire: 0,
    age: 0,
    elevation: 0,
    hasPipe: false,
    hasPowerLine: false,
    anchor: -1,
    rotation: 0,
  };
}
function roads(points: [number, number][]): RoadNetwork {
  return interiorRoadNetwork(points);
}
function crossAt(x = 0): [number, number][] {
  return [
    [x, 0],
    [x, -1],
    [x, 1],
    [x - 1, 0],
    [x + 1, 0],
  ];
}
function unique(points: [number, number][]): [number, number][] {
  return [...new Map(points.map((p) => [p.join(','), p])).values()];
}
function contiguous(path: Point[]): void {
  for (let i = 1; i < path.length; i++)
    assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].z - path[i - 1].z), 1);
}

test('straight interior streets do not receive traffic lights or reservations', () => {
  const network = roads([
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
  assert.equal(network.junctions.length, 0);
  assert.equal(network.approaches.size, 0);
});

test('a sharp bend receives unlit collision protection and ignores adjacent non-road tiles', () => {
  const network = buildRoadNetwork({
    tiles: [
      [0, -2],
      [0, -1],
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ]
      .map((p) => tile(p as [number, number]))
      .concat([tile([1, 0], 'rail'), tile([-1, 1], 'residential')]),
  });
  assert.equal(network.roads.size, 8);
  assert.equal(network.junctionAt.get('0,1')?.signalized, false);
  assert.equal(network.junctionAt.get('0,1')?.approaches.length, 2);
  assert.deepEqual(network.neighbors.get('0,1'), [
    { x: 0, z: 0 },
    { x: 1, z: 1 },
  ]);
});

test('T and four-way crossings discover every external incoming approach once', () => {
  for (const count of [3, 4]) {
    const network = roads(crossAt().slice(0, count + 1));
    assert.equal(network.junctions.length, 1);
    const junction = network.junctions[0];
    assert.deepEqual(junction.cells, [{ x: 0, z: 0 }]);
    assert.equal(junction.approaches.length, count);
    assert.equal(network.approaches.size, count);
    for (const approach of junction.approaches) {
      assert.equal(approach.id, approachKey(approach.from, approach.entry));
      assert.equal(approach.junctionId, junction.id);
      assert.equal(network.junctionAt.get('0,0'), junction);
      assert.deepEqual(approach.direction, { x: 0 - approach.from.x, z: 0 - approach.from.z });
    }
  }
});

test('adjacent crossings share one controller with no internal approach or exit', () => {
  const network = roads([
    [-1, 0],
    [0, 0],
    [1, 0],
    [2, 0],
    [0, -1],
    [1, 1],
  ]);
  assert.equal(network.junctions.length, 1);
  const junction = network.junctions[0];
  assert.deepEqual(junction.cells, [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ]);
  assert.equal(junction.approaches.length, 4);
  for (const approach of junction.approaches)
    assert.equal(network.junctionAt.has(roadPointKey(approach.from)), false);
});

test('a one-tile connector between crossings is included in their shared occupied space', () => {
  const network = roads(unique([...crossAt(), ...crossAt(2)]));
  assert.equal(network.junctions.length, 1);
  assert.deepEqual(network.junctions[0].cells, [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 2, z: 0 },
  ]);
  assert.equal(network.junctionAt.get('1,0'), network.junctions[0]);
  assert.equal(network.junctions[0].approaches.length, 6);
});

test('crossings with two full intervening road tiles retain separate controllers', () => {
  const network = roads(unique([...crossAt(), ...crossAt(3)]));
  assert.equal(network.junctions.length, 2);
  assert.equal(network.junctionAt.has('1,0'), false);
  assert.equal(network.junctionAt.has('2,0'), false);
  assert.notEqual(network.junctionAt.get('0,0')?.id, network.junctionAt.get('3,0')?.id);
});

test('junction IDs, approach order and planned routes do not depend on tile insertion order', () => {
  const points = unique([...crossAt(), ...crossAt(2), [10, 0], [10, 1], [10, -1], [9, 0]]);
  const first = roads(points),
    reversed = roads([...points].reverse());
  assert.deepEqual(first.junctions, reversed.junctions);
  for (const a of first.junctions[0].approaches)
    for (let choice = 0; choice < 5; choice++) {
      assert.deepEqual(
        planJunctionMovement(first, a.from, a.entry, choice),
        planJunctionMovement(reversed, a.from, a.entry, choice),
      );
    }
});

test('each approach can reach every other external exit along a contiguous complete cluster route', () => {
  for (const spacing of [1, 2]) {
    const network = roads(unique([...crossAt(), ...crossAt(spacing)])),
      junction = network.junctions[0];
    for (const approach of junction.approaches) {
      const reached = new Set<string>();
      for (let choice = 0; choice < junction.approaches.length - 1; choice++) {
        const movement = planJunctionMovement(network, approach.from, approach.entry, choice);
        assert.ok(movement);
        assert.equal(movement.junctionId, junction.id);
        assert.equal(movement.approachId, approach.id);
        assert.deepEqual(movement.path[0], approach.entry);
        assert.deepEqual(movement.path.at(-1), movement.exit);
        assert.notDeepEqual(movement.exit, approach.from);
        contiguous([approach.from, ...movement.path]);
        for (const p of movement.path.slice(0, -1))
          assert.equal(network.junctionAt.get(roadPointKey(p))?.id, junction.id);
        assert.equal(network.junctionAt.has(roadPointKey(movement.exit)), false);
        const beforeExit = movement.path.at(-2)!;
        assert.deepEqual(movement.exitDirection, {
          x: movement.exit.x - beforeExit.x,
          z: movement.exit.z - beforeExit.z,
        });
        reached.add(roadPointKey(movement.exit));
      }
      assert.equal(reached.size, junction.approaches.length - 1);
    }
  }
});

test('ordinary roads and removed entrances cannot produce stale junction movements', () => {
  const from = { x: -1, z: 0 },
    entry = { x: 0, z: 0 };
  const initial = roads(crossAt());
  assert.ok(planJunctionMovement(initial, from, entry));
  const edited = roads(crossAt().filter(([x]) => x !== -1));
  assert.equal(planJunctionMovement(edited, from, entry), null);
  assert.equal(planJunctionMovement(initial, { x: -2, z: 0 }, from), null);
});

test('an emergency-service frontage receives unlit merge protection and disappears with the facility', () => {
  const state = { tiles: Array.from({ length: 9 }, (_, x) => tile([x, 0])) };
  state.tiles.push(tile([4, 1], 'fire'));
  const network = buildRoadNetwork(state);
  assert.equal(network.junctionAt.get('4,0')?.signalized, false);
  state.tiles.pop();
  assert.equal(buildRoadNetwork(state).junctionAt.has('4,0'), false);
});

test('a dead-end U-turn is protected and adjacent short termini share the crossing clearance', () => {
  const points: [number, number][] = [];
  for (let x = 1; x <= 7; x++) points.push([x, 4]);
  for (let z = 3; z <= 7; z++) if (z !== 4) points.push([4, z]);
  const network = buildRoadNetwork({ tiles: points.map((p) => tile(p)) });
  assert.equal(network.junctionAt.get('4,3'), network.junctionAt.get('4,4'));
  assert.equal(network.junctionAt.get('4,3')?.signalized, true);
  assert.equal(network.junctionAt.get('1,4')?.signalized, false);
  assert.notEqual(network.junctionAt.get('1,4'), network.junctionAt.get('4,4'));
});

test('driveway turns pre-plan contiguous cluster routes through a real exit before admission', () => {
  const network = roads(unique([...crossAt(), ...crossAt(1)]));
  const m = planExternalMovement(network, { x: 0, z: 0 }, { x: 1, z: 0 }, 42);
  assert.ok(m);
  assert.deepEqual(m.path.slice(0, 2), [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ]);
  contiguous(m.path);
  assert.equal(network.junctionAt.has(roadPointKey(m.exit)), false);
  assert.equal(m.approachId, 'external:42');
});
