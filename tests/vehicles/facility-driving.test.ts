import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDrivingController,
  drivingObstacle,
  drivingSurfaceHeight,
  getVehicleDimensions,
  type DrivableCar,
} from '../../src/vehicles/driving.ts';
import {
  FACILITY_ACCESS_FOOTPRINTS,
  facilityLocalToWorld,
  getFacilityAccess,
  sampleFacilityAccessAt,
} from '../../src/buildings/facility-access.ts';
import { createFacilityServiceVehicle } from '../../src/rendering/buildings/models.ts';
import { sampleRoadHeight } from '../../src/rendering/infrastructure/roads.ts';
import { createCity } from '../../src/simulation/city-simulation.ts';
import type { Tile } from '../../src/domain/types.ts';

const kinds = ['fire', 'hospital', 'police'] as const;
const rotations = [0, 1, 2, 3] as const;
const sides = ['north', 'east', 'south', 'west'] as const;
type Kind = (typeof kinds)[number];
type Side = (typeof sides)[number];

function fixture(kind: Kind, rotation: Tile['rotation'], side: Side, elevation: number) {
  const state = createCity(917, true, 40),
    x = 15,
    z = 15;
  for (const tile of state.tiles) {
    Object.assign(tile, { kind: 'empty', level: 0, elevation: 0, anchor: -1, rotation: 0 });
  }
  const nominal = FACILITY_ACCESS_FOOTPRINTS[kind]!;
  const [width, depth] = rotation % 2 ? [nominal[1], nominal[0]] : nominal;
  const anchor = z * state.size + x;
  for (let zz = z; zz < z + depth; zz++)
    for (let xx = x; xx < x + width; xx++) {
      Object.assign(state.tiles[zz * state.size + xx], {
        kind,
        level: 1,
        elevation,
        anchor,
        rotation,
      });
    }
  const roadX = side === 'west' ? x - 1 : side === 'east' ? x + width : x + Math.floor(width / 2);
  const roadZ = side === 'north' ? z - 1 : side === 'south' ? z + depth : z + Math.floor(depth / 2);
  const dx = side === 'west' ? -1 : side === 'east' ? 1 : 0;
  const dz = side === 'north' ? -1 : side === 'south' ? 1 : 0;
  for (let i = 0; i < 4; i++)
    state.tiles[(roadZ + dz * i) * state.size + roadX + dx * i].kind = 'road';
  state.revision++;
  const plan = getFacilityAccess(state, state.tiles[anchor]);
  assert.ok(plan?.connected && plan.road && plan.to && plan.previous);
  const model = createFacilityServiceVehicle(
    kind === 'fire' ? 'firetruck' : kind === 'hospital' ? 'ambulance' : 'police',
  );
  return {
    state,
    plan,
    model,
    dimensions: getVehicleDimensions(model),
    direction: { x: dx, z: dz },
  };
}

for (const elevation of [0, 0.2]) {
  test(`full emergency vehicles clear every driveway side and rotation at elevation ${elevation}, while walls remain solid`, () => {
    for (const kind of kinds)
      for (const rotation of rotations)
        for (const side of sides) {
          const { state, plan, dimensions } = fixture(kind, rotation, side, elevation);
          const label = `${kind}/${rotation}/${side}/${elevation}`;
          for (let i = 0; i < plan.points.length; i++) {
            const point = plan.points[i];
            const previous = plan.points[Math.max(0, i - 1)],
              next = plan.points[Math.min(plan.points.length - 1, i + 1)];
            const yaw = Math.atan2(next.x - previous.x, next.z - previous.z);
            assert.equal(
              drivingObstacle(state, point.x, point.z, yaw, dimensions),
              undefined,
              `${label}: complete vehicle must clear the route at point ${i}`,
            );
          }
          const localWall =
            kind === 'fire'
              ? { x: -0.2, z: -0.25 }
              : kind === 'hospital'
                ? { x: -0.1, z: -0.5 }
                : { x: -0.3, z: -0.29 };
          const wall = facilityLocalToWorld(plan, {
            x: localWall.x * plan.contentScale.x,
            z: localWall.z * plan.contentScale.z,
          });
          assert.equal(
            drivingObstacle(state, wall.x, wall.z, 0, dimensions),
            'Gebäude im Weg',
            `${label}: reserving a driveway must preserve the real building walls`,
          );
        }
  });
}

test('an elevated driveway never supplies a phantom hill past its endpoint on the actual road', () => {
  for (const kind of kinds)
    for (const side of sides) {
      const { state, plan, direction } = fixture(kind, 0, side, 0.5);
      const end = plan.points.at(-1)!;
      for (const distance of [0.0001, 0.02, 0.1, 0.16, 0.18, 0.2, 0.22, 0.225, 0.3, 0.7]) {
        const x = end.x + direction.x * distance,
          z = end.z + direction.z * distance;
        assert.equal(
          sampleFacilityAccessAt(state, x, z),
          null,
          `${kind}/${side}: the road owns wheel support ${distance} tiles beyond the gate`,
        );
        assert.ok(
          Math.abs(drivingSurfaceHeight(state, x, z) - sampleRoadHeight(state, x, z) - 0.057) <
            1e-9,
          `${kind}/${side}: no hidden plateau on the road at ${distance}`,
        );
      }
    }
});

test('the driving controller takes full service vehicles down the driveway and reverses back up without a ledge', () => {
  for (const kind of kinds)
    for (const elevation of [0.2, 0.5])
      for (const reversing of [false, true]) {
        const { state, plan, model } = fixture(kind, 0, 'south', elevation);
        const end = plan.points.at(-1)!,
          startZ = end.z + (reversing ? 0.7 : -0.2);
        model.position.set(end.x, drivingSurfaceHeight(state, end.x, startZ), startZ);
        model.rotation.y = 0;
        const car: DrivableCar = {
          model,
          from: plan.road!,
          previous: plan.previous!,
          to: plan.to!,
          progress: 0,
          speed: 0,
        };
        const controller = createDrivingController(state, () => [car]);
        const label = `${kind}/${elevation}/${reversing ? 'reverse into yard' : 'exit onto road'}`;
        try {
          assert.equal(controller.enter(model.id), true, label);
          assert.equal(controller.keyDown(reversing ? 'KeyS' : 'KeyW'), true, label);
          let arrived = false;
          for (let frame = 0; frame < 360; frame++) {
            controller.update(1 / 120);
            assert.equal(
              controller.getStatus().blocked,
              undefined,
              `${label}: no physical slope or obstacle should stop the vehicle`,
            );
            assert.ok(
              model.position.toArray().every(Number.isFinite),
              `${label}: finite suspension`,
            );
            arrived = reversing ? model.position.z < end.z - 0.19 : model.position.z > end.z + 0.7;
            if (arrived) break;
          }
          assert.ok(arrived, `${label}: must physically cross the driveway/road seam`);
          assert.equal(controller.getStatus().collisionCount, 0, label);
          if (!reversing) {
            assert.ok(
              Math.abs(
                model.position.y - drivingSurfaceHeight(state, model.position.x, model.position.z),
              ) < 0.025,
              `${label}: all wheels settle on the actual road beyond the complete vehicle length`,
            );
          }
        } finally {
          controller.dispose();
        }
      }
});

test('cached facility collision geometry follows road addition and removal without relying on a revision bump', () => {
  const { state, plan, dimensions } = fixture('police', 0, 'south', 0);
  const point = facilityLocalToWorld(plan, { x: -0.7, z: -0.3 });
  assert.equal(
    drivingObstacle(state, point.x, point.z, 0, dimensions),
    undefined,
    'The connected property leaves its outer side lane clear',
  );
  const road = state.tiles[plan.road!.z * state.size + plan.road!.x],
    revision = state.revision;
  road.kind = 'empty';
  assert.equal(
    drivingObstacle(state, point.x, point.z, 0, dimensions),
    'Gebäude im Weg',
    'Removing access restores the disconnected building layout in the existing collision cache',
  );
  road.kind = 'road';
  assert.equal(
    drivingObstacle(state, point.x, point.z, 0, dimensions),
    undefined,
    'Reconnecting the road clears the actual inset lane again',
  );
  assert.equal(
    state.revision,
    revision,
    'This is a neighbor-driven cache regression, not a global reset',
  );
});
