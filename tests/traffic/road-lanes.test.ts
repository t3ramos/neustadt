import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lanePathLength,
  lanePose,
  ROAD_LANE_OFFSET,
  type LanePose,
} from '../../src/traffic/lanes.ts';
import { createDetailedCar } from '../../src/rendering/vehicles/model.ts';
import { findVehicleContact, type VehicleContactBody } from '../../src/vehicles/contacts.ts';
import type { Point } from '../../src/domain/types.ts';

const directions: Point[] = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];
const centre = { x: 12, z: 8 };
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, z: a.z + b.z });
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} must be ${expected} ± ${tolerance}`,
  );
}
function closePoint(actual: Point, expected: Point, tolerance = 1e-9): void {
  close(actual.x, expected.x, tolerance);
  close(actual.z, expected.z, tolerance);
}
function heading(pose: LanePose, expected: Point): void {
  close(pose.tangentX, expected.x);
  close(pose.tangentZ, expected.z);
  close(Math.sin(pose.yaw), expected.x);
  close(Math.cos(pose.yaw), expected.z);
}

test('every road direction enters and exits its tile edge in the right-hand lane', () => {
  for (const incoming of directions)
    for (const outgoing of directions) {
      const previous = subtract(centre, incoming),
        to = add(centre, outgoing);
      const entry = lanePose(previous, centre, to, 0),
        exit = lanePose(previous, centre, to, 1);
      closePoint(entry, {
        x: centre.x + 0.5 - 0.5 * incoming.x - ROAD_LANE_OFFSET * incoming.z,
        z: centre.z + 0.5 - 0.5 * incoming.z + ROAD_LANE_OFFSET * incoming.x,
      });
      closePoint(exit, {
        x: centre.x + 0.5 + 0.5 * outgoing.x - ROAD_LANE_OFFSET * outgoing.z,
        z: centre.z + 0.5 + 0.5 * outgoing.z + ROAD_LANE_OFFSET * outgoing.x,
      });
      heading(entry, incoming);
      heading(exit, outgoing);
    }
});

test('adjacent straight, corner and U-turn paths have identical edge position and tangent in every rotation', () => {
  for (const incoming of directions)
    for (const outgoing of directions)
      for (const after of directions) {
        const previous = subtract(centre, incoming),
          to = add(centre, outgoing),
          next = add(to, after);
        const exit = lanePose(previous, centre, to, 1),
          entry = lanePose(centre, to, next, 0);
        closePoint(exit, entry);
        close(exit.tangentX, entry.tangentX);
        close(exit.tangentZ, entry.tangentZ);
      }
});

test('straight routes cover exactly one tile at uniform distance, with fresh routes using their outgoing heading', () => {
  for (const outgoing of directions) {
    const previous = subtract(centre, outgoing),
      to = add(centre, outgoing);
    close(lanePathLength(previous, centre, to), 1);
    const start = lanePose(previous, centre, to, 0);
    for (let n = 0; n <= 20; n++) {
      const progress = n / 20,
        pose = lanePose(previous, centre, to, progress);
      closePoint(pose, { x: start.x + outgoing.x * progress, z: start.z + outgoing.z * progress });
      assert.deepEqual(lanePose(centre, centre, to, progress), pose);
      heading(pose, outgoing);
    }
  }
});

test('curves remain within their road tile and have finite unit headings, including bounded dead-end U-turns', () => {
  for (const incoming of directions)
    for (const outgoing of directions) {
      const previous = subtract(centre, incoming),
        to = add(centre, outgoing);
      for (let n = 0; n <= 200; n++) {
        const pose = lanePose(previous, centre, to, n / 200);
        assert.ok(Object.values(pose).every(Number.isFinite));
        assert.ok(pose.x >= centre.x && pose.x <= centre.x + 1);
        assert.ok(pose.z >= centre.z && pose.z <= centre.z + 1);
        close(Math.hypot(pose.tangentX, pose.tangentZ), 1);
        close(Math.sin(pose.yaw), pose.tangentX);
        close(Math.cos(pose.yaw), pose.tangentZ);
        assert.ok(pose.pathLength > 0.4 && pose.pathLength < 1.5);
      }
    }
});

test('arclength progress gives equal travelled distances through tight and wide turns and U-turns', () => {
  const previous = subtract(centre, directions[0]);
  for (const outgoing of directions.slice(1)) {
    const to = add(centre, outgoing),
      length = lanePathLength(previous, centre, to);
    let total = 0,
      last = lanePose(previous, centre, to, 0);
    for (let section = 0; section < 10; section++) {
      let travelled = 0;
      for (let n = 1; n <= 50; n++) {
        const pose = lanePose(previous, centre, to, (section + n / 50) / 10);
        travelled += Math.hypot(pose.x - last.x, pose.z - last.z);
        last = pose;
      }
      close(travelled, length / 10, 2e-5);
      total += travelled;
    }
    close(total, length, 4e-5);
  }
});

test('curve geometry and path length rotate and translate consistently', () => {
  const rotate = (point: Point): Point => ({ x: -point.z, z: point.x });
  for (const outgoing of directions) {
    for (let n = 0; n <= 16; n++) {
      const previous = subtract(centre, directions[0]),
        to = add(centre, outgoing);
      const pose = lanePose(previous, centre, to, n / 16);
      const movedFrom = { x: 3, z: 21 },
        movedIncoming = rotate(directions[0]),
        movedOutgoing = rotate(outgoing);
      const moved = lanePose(
        subtract(movedFrom, movedIncoming),
        movedFrom,
        add(movedFrom, movedOutgoing),
        n / 16,
      );
      const localRotated = rotate({ x: pose.x - centre.x - 0.5, z: pose.z - centre.z - 0.5 });
      closePoint(moved, {
        x: movedFrom.x + 0.5 + localRotated.x,
        z: movedFrom.z + 0.5 + localRotated.z,
      });
      close(moved.tangentX, -pose.tangentZ);
      close(moved.tangentZ, pose.tangentX);
      close(moved.pathLength, pose.pathLength);
    }
  }
});

test('opposing real truck bodies including traffic clearance pass on straight roads in every rotation', () => {
  const truck = createDetailedCar(0xffffff, 'truck');
  const dimensions = truck.userData.vehicleDimensions as {
    width: number;
    length: number;
    height: number;
    mass: number;
  };
  const body = (pose: LanePose): VehicleContactBody => ({
    x: pose.x,
    z: pose.z,
    y: 0,
    yaw: pose.yaw,
    vx: 0,
    vz: 0,
    angularVelocity: 0,
    halfWidth: dimensions.width / 2 + 0.014,
    halfLength: dimensions.length / 2 + 0.024,
    height: dimensions.height,
    mass: dimensions.mass,
  });
  for (const direction of directions)
    for (let n = 0; n <= 40; n++) {
      const before = subtract(centre, direction),
        after = add(centre, direction);
      const forward = lanePose(before, centre, after, n / 40);
      const backward = lanePose(after, centre, before, n / 40);
      assert.equal(findVehicleContact(body(forward), body(backward)), null);
    }
});

test('progress clamps at edges and zero-width or missing-direction routes never produce non-finite poses', () => {
  const previous = subtract(centre, directions[0]),
    to = add(centre, directions[0]);
  assert.deepEqual(lanePose(previous, centre, to, -Infinity), lanePose(previous, centre, to, 0));
  assert.deepEqual(lanePose(previous, centre, to, Infinity), lanePose(previous, centre, to, 1));
  assert.deepEqual(lanePose(previous, centre, to, NaN), lanePose(previous, centre, to, 0));
  for (let n = 0; n <= 100; n++) {
    assert.ok(
      Object.values(lanePose(previous, centre, previous, n / 100, 0)).every(Number.isFinite),
    );
    assert.ok(Object.values(lanePose(centre, centre, centre, n / 100)).every(Number.isFinite));
  }
});
