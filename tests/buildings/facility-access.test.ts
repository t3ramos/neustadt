import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FACILITY_ACCESS_FOOTPRINTS,
  FACILITY_ACCESS_WIDTH,
  FACILITY_PAVEMENT_HEIGHT,
  facilityAccessSignature,
  facilityLocalToWorld,
  facilityWorldToLocal,
  getFacilityAccess,
  listFacilityServiceRoutes,
  sampleFacilityAccessAt,
  sampleFacilityAccessHeight,
  type FacilityAccessPlan,
} from '../../src/buildings/facility-access.ts';
import { lanePose } from '../../src/traffic/lanes.ts';
import { sampleRoadHeight } from '../../src/rendering/infrastructure/roads.ts';
import { createCity, TOOL_DEFS } from '../../src/simulation/city-simulation.ts';
import type { CityState, Point, Tile, TileKind } from '../../src/domain/types.ts';

const civicKinds: TileKind[] = [
  'power',
  'waterpump',
  'police',
  'fire',
  'hospital',
  'school',
  'university',
  'stadium',
  'airport',
  'seaport',
  'wind',
  'solar',
  'recycling',
];
const rotations = [0, 1, 2, 3] as const;
const sides = ['north', 'east', 'south', 'west'] as const;
type Side = (typeof sides)[number];

function close(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} must be ${expected} ± ${tolerance}`,
  );
}
function closePoint(actual: Point, expected: Point, message: string): void {
  close(actual.x, expected.x, `${message} x`);
  close(actual.z, expected.z, `${message} z`);
}
function at(state: CityState, point: Point): Tile {
  return state.tiles[point.z * state.size + point.x];
}
function fixture(kind: TileKind, rotation: Tile['rotation'] = 0, elevation = 2) {
  const state = createCity(5318, true, 40),
    anchor = { x: 12, z: 12 };
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.elevation = elevation;
    tile.anchor = -1;
    tile.rotation = 0;
    tile.level = 0;
  }
  const definition = TOOL_DEFS[kind];
  assert.ok(definition, `${kind} must have a construction tool definition`);
  const original = kind === 'industrial' ? ([1, 1] as const) : definition.footprint;
  assert.ok(original, `${kind} must have a saved footprint`);
  const [width, depth] = rotation % 2 ? [original[1], original[0]] : original;
  const anchorId = anchor.z * state.size + anchor.x;
  for (let dz = 0; dz < depth; dz++)
    for (let dx = 0; dx < width; dx++) {
      const tile = at(state, { x: anchor.x + dx, z: anchor.z + dz });
      tile.kind = kind;
      tile.rotation = rotation;
      tile.anchor = anchorId;
      tile.level = 1;
    }
  return { state, tile: at(state, anchor), width, depth };
}
function attachRoad(
  state: CityState,
  tile: Tile,
  width: number,
  depth: number,
  side: Side,
  elevation = tile.elevation,
) {
  const road =
    side === 'north'
      ? { x: tile.x + Math.floor(width / 2), z: tile.z - 1 }
      : side === 'south'
        ? { x: tile.x + Math.floor(width / 2), z: tile.z + depth }
        : side === 'west'
          ? { x: tile.x - 1, z: tile.z + Math.floor(depth / 2) }
          : { x: tile.x + width, z: tile.z + Math.floor(depth / 2) };
  const direction =
    side === 'north'
      ? { x: 0, z: -1 }
      : side === 'south'
        ? { x: 0, z: 1 }
        : side === 'west'
          ? { x: -1, z: 0 }
          : { x: 1, z: 0 };
  const previous = { x: road.x - direction.x, z: road.z - direction.z };
  const to = { x: road.x + direction.x, z: road.z + direction.z };
  for (const point of [road, to]) {
    at(state, point).kind = 'road';
    at(state, point).elevation = elevation;
  }
  return { road, previous, to, direction };
}
function requirePlan(state: CityState, tile: Tile): FacilityAccessPlan {
  const plan = getFacilityAccess(state, tile);
  assert.ok(plan);
  return plan;
}

for (const kind of civicKinds) {
  test(`${kind} keeps its saved footprint and joins every adjacent road side in all four rotations`, () => {
    const definition = TOOL_DEFS[kind];
    assert.ok(definition);
    assert.deepEqual(
      FACILITY_ACCESS_FOOTPRINTS[kind],
      definition.footprint,
      'Access layout must use the actual construction footprint',
    );
    for (const rotation of rotations)
      for (const side of sides) {
        const { state, tile, width, depth } = fixture(kind, rotation);
        const connection = attachRoad(state, tile, width, depth, side);
        const before = JSON.stringify(state),
          plan = requirePlan(state, tile),
          label = `${kind}/${rotation}/${side}`;
        assert.equal(plan.connected, true, label);
        assert.deepEqual(plan.road, connection.road, `${label} road`);
        assert.deepEqual(plan.previous, connection.previous, `${label} approach`);
        assert.deepEqual(plan.to, connection.to, `${label} onward route`);
        assert.equal(plan.width, width);
        assert.equal(plan.depth, depth);
        assert.equal(plan.rotation, rotation);
        assert.equal(plan.baseY, tile.elevation);
        assert.equal(plan.laneWidth, FACILITY_ACCESS_WIDTH);
        assert.ok(plan.contentScale.x > 0 && plan.contentScale.x < 1);
        assert.ok(plan.contentScale.z > 0 && plan.contentScale.z < 1);
        assert.ok(plan.points.length > 1, `${label} needs a traversable drive`);
        assert.ok(
          plan.renderSegments.length > 4,
          `${label} needs a paved property perimeter and an exit`,
        );
        closePoint(
          plan.center,
          { x: tile.x + width / 2 - state.size / 2, z: tile.z + depth / 2 - state.size / 2 },
          `${label} center`,
        );
        const pose = lanePose(connection.previous, connection.road, connection.to, 0);
        closePoint(
          plan.points.at(-1)!,
          { x: pose.x - state.size / 2, z: pose.z - state.size / 2 },
          `${label} lane entry`,
        );
        for (const point of plan.points) {
          assert.ok(Object.values(point).every(Number.isFinite), `${label} finite route`);
          // The driveway stays on its saved property until the exact shared road boundary.
          assert.ok(
            point.x >= tile.x - state.size / 2 - 1e-8 &&
              point.x <= tile.x + width - state.size / 2 + 1e-8,
            `${label} driveway x remains inside the property`,
          );
          assert.ok(
            point.z >= tile.z - state.size / 2 - 1e-8 &&
              point.z <= tile.z + depth - state.size / 2 + 1e-8,
            `${label} driveway z remains inside the property`,
          );
          closePoint(
            facilityLocalToWorld(plan, facilityWorldToLocal(plan, point)),
            point,
            `${label} local/world inverse`,
          );
        }
        const child = at(state, { x: tile.x + width - 1, z: tile.z + depth - 1 });
        assert.equal(
          getFacilityAccess(state, child),
          plan,
          'Every saved footprint tile must resolve to the same entrance',
        );
        assert.equal(
          JSON.stringify(state),
          before,
          'Planning and coordinate sampling must never rewrite saved tiles, anchors, elevations, or rotation',
        );
      }
  });
}

test('the existing starter police and fire stations connect east and the hospital connects north', () => {
  for (const size of [40, 64, 128]) {
    const state = createCity(2026, false, size);
    for (const kind of ['police', 'fire', 'hospital'] as const) {
      const tile = state.tiles.find(
        (t) => t.kind === kind && (t.anchor < 0 || t.anchor === t.z * state.size + t.x),
      )!;
      const plan = requirePlan(state, tile);
      assert.equal(plan.connected, true, `${kind} in the ${size}-tile starter city`);
      assert.ok(plan.road);
      assert.ok(plan.to);
      if (kind === 'hospital')
        assert.equal(plan.road.z, tile.z - 1, 'Hospital must use its actual north road');
      else assert.equal(plan.road.x, tile.x + plan.width, `${kind} must use its actual east road`);
    }
  }
});

test('in-place road additions, removal, and elevation edits invalidate access without a city revision change', () => {
  const { state, tile, width, depth } = fixture('fire');
  const revision = state.revision,
    initial = requirePlan(state, tile);
  assert.equal(initial.connected, false);
  assert.equal(
    getFacilityAccess(state, tile),
    initial,
    'Unchanged queries reuse their deterministic plan',
  );
  const connection = attachRoad(state, tile, width, depth, 'east');
  const attached = requirePlan(state, tile);
  assert.notEqual(attached, initial);
  assert.equal(attached.connected, true);
  assert.notEqual(attached.signature, initial.signature);
  at(state, connection.road).elevation += 0.2;
  const raisedRoad = requirePlan(state, tile);
  assert.notEqual(raisedRoad, attached);
  assert.notEqual(raisedRoad.points.at(-1)!.y, attached.points.at(-1)!.y);
  // This diagonal tile touches the entrance's road corner but is not a direct property neighbor.
  const diagonal = at(state, { x: connection.road.x + 1, z: connection.road.z + 1 });
  diagonal.kind = 'road';
  diagonal.elevation = 3;
  const cornerChanged = requirePlan(state, tile);
  assert.notEqual(
    cornerChanged,
    raisedRoad,
    'Corner-height dependencies must also invalidate the cache',
  );
  assert.notEqual(cornerChanged.points.at(-1)!.y, raisedRoad.points.at(-1)!.y);
  diagonal.kind = 'empty';
  at(state, connection.road).kind = 'empty';
  const removed = requirePlan(state, tile);
  assert.notEqual(removed, cornerChanged);
  assert.equal(removed.connected, false);
  assert.equal(removed.road, null);
  assert.equal(removed.to, null);
  assert.equal(removed.points.length, 1);
  const signature = facilityAccessSignature(state, tile);
  tile.elevation += 0.2;
  const raisedFacility = requirePlan(state, tile);
  assert.notEqual(raisedFacility.signature, signature);
  close(raisedFacility.baseY, 2.2, 'New facility foundation');
  assert.equal(
    state.revision,
    revision,
    'Invalidation must not require recalculate() or a manual revision bump',
  );
});

test('service routes start parked without a road or onward connection and exist once per facility', () => {
  for (const kind of ['police', 'fire', 'hospital'] as const) {
    const { state, tile, width, depth } = fixture(kind);
    let routes = listFacilityServiceRoutes(state);
    assert.equal(
      routes.length,
      1,
      'Multi-tile facilities must not spawn a vehicle per occupied tile',
    );
    assert.equal(routes[0].connected, false);
    assert.equal(routes[0].points.length, 1);
    assert.deepEqual(routes[0].spawn, routes[0].points[0]);
    assert.equal(routes[0].progress, 0);
    assert.equal(routes[0].road, null);
    assert.equal(routes[0].to, null);
    assert.ok(Number.isFinite(routes[0].yaw));
    const connection = attachRoad(state, tile, width, depth, 'south');
    at(state, connection.to).kind = 'empty';
    routes = listFacilityServiceRoutes(state);
    assert.equal(
      routes[0].connected,
      false,
      'A single isolated road tile is not a drivable dispatch route',
    );
    assert.equal(routes[0].to, null);
    assert.deepEqual(routes[0].spawn, routes[0].points[0]);
    at(state, connection.to).kind = 'road';
    assert.equal(
      listFacilityServiceRoutes(state)[0].connected,
      true,
      'Completing the road opens dispatch immediately',
    );
  }
});

test('emergency routes meet lanePose exactly and keep the vehicle suspension .005 above their rendered drive', () => {
  for (const kind of ['police', 'fire', 'hospital'] as const)
    for (const rotation of rotations)
      for (const side of sides) {
        const { state, tile, width, depth } = fixture(kind, rotation);
        const connection = attachRoad(state, tile, width, depth, side);
        const plan = requirePlan(state, tile),
          [route] = listFacilityServiceRoutes(state);
        assert.equal(
          route.kind,
          kind === 'fire' ? 'firetruck' : kind === 'hospital' ? 'ambulance' : 'police',
        );
        assert.equal(route.id, plan.id);
        assert.equal(route.connected, true);
        assert.equal(route.progress, 0);
        assert.deepEqual(route.previous, plan.previous);
        assert.deepEqual(route.road, plan.road);
        assert.deepEqual(route.to, plan.to);
        const pose = lanePose(route.previous!, route.road!, route.to!, 0),
          end = route.points.at(-1)!;
        closePoint(
          end,
          { x: pose.x - state.size / 2, z: pose.z - state.size / 2 },
          `${kind}/${rotation}/${side} exact lanePose entry`,
        );
        close(
          end.y,
          sampleRoadHeight(
            state,
            end.x + connection.direction.x * 1e-6,
            end.z + connection.direction.z * 1e-6,
          ) +
            FACILITY_PAVEMENT_HEIGHT +
            0.005,
          'Road and suspension meet without a height step',
        );
        assert.equal(route.points.length, plan.points.length);
        for (let i = 0; i < route.points.length; i++) {
          closePoint(route.points[i], plan.points[i], 'Vehicle path matches the paved path');
          close(route.points[i].y, plan.points[i].y + 0.005, 'Vehicle clearance');
        }
      }
});

test('a .2 elevation difference ramps safely uphill and downhill, with exact pavement sampling through every rotated route', () => {
  for (const kind of civicKinds)
    for (const rotation of rotations)
      for (const side of sides)
        for (const delta of [-0.2, 0.2]) {
          const { state, tile, width, depth } = fixture(kind, rotation);
          attachRoad(state, tile, width, depth, side, tile.elevation + delta);
          const plan = requirePlan(state, tile),
            label = `${kind}/${rotation}/${side}/${delta}`;
          close(
            plan.points[0].y,
            tile.elevation + FACILITY_PAVEMENT_HEIGHT,
            `${label} starts at its foundation`,
          );
          close(
            plan.points.at(-1)!.y,
            tile.elevation + delta + FACILITY_PAVEMENT_HEIGHT,
            `${label} ends at its road`,
          );
          for (let i = 0; i < plan.points.length; i++) {
            const point = plan.points[i];
            close(
              sampleFacilityAccessHeight(plan, point.x, point.z)!,
              point.y,
              `${label} route vertex ${i} uses the actual paved height`,
            );
            const owner = at(state, {
              x: Math.floor(point.x + state.size / 2),
              z: Math.floor(point.z + state.size / 2),
            });
            if (owner.kind === 'road')
              assert.equal(
                sampleFacilityAccessAt(state, point.x, point.z),
                null,
                `${label} road endpoint hands suspension back to the public road`,
              );
            else
              close(
                sampleFacilityAccessAt(state, point.x, point.z)!,
                point.y,
                `${label} world suspension sample ${i}`,
              );
            if (!i) continue;
            const before = plan.points[i - 1],
              distance = Math.hypot(point.x - before.x, point.z - before.z);
            if (distance > 1e-10)
              assert.ok(
                Math.abs(point.y - before.y) / distance < 2.2,
                `${label} ramp must remain below the vehicle's impassable slope limit`,
              );
            else
              close(
                point.y,
                before.y,
                `${label} coincident route points cannot have a vertical jump`,
              );
            for (const fraction of [0.25, 0.5, 0.75]) {
              const x = before.x + (point.x - before.x) * fraction,
                z = before.z + (point.z - before.z) * fraction;
              close(
                sampleFacilityAccessHeight(plan, x, z)!,
                before.y + (point.y - before.y) * fraction,
                `${label} continuous suspension between route points ${i}`,
              );
            }
          }
          assert.equal(
            sampleFacilityAccessHeight(plan, plan.center.x, plan.center.z),
            null,
            'The center building is not part of its access pavement',
          );
          assert.equal(
            sampleFacilityAccessAt(state, -19.5, -19.5),
            null,
            'Unrelated ground must not become facility pavement',
          );
        }
});

test('industrial entrances face their actual road without rewriting the saved building rotation or occupying neighboring lots', () => {
  assert.deepEqual(
    FACILITY_ACCESS_FOOTPRINTS.industrial,
    [1, 1],
    'Industrial zones keep their original one-tile footprint',
  );
  for (const rotation of rotations)
    for (const side of sides) {
      const { state, tile, width, depth } = fixture('industrial', rotation);
      const connection = attachRoad(state, tile, width, depth, side),
        before = JSON.stringify(state);
      const plan = requirePlan(state, tile),
        label = `industrial/${rotation}/${side}`;
      assert.equal(plan.connected, true);
      assert.equal(plan.width, 1);
      assert.equal(plan.depth, 1);
      assert.deepEqual(plan.road, connection.road);
      assert.deepEqual(plan.previous, connection.previous);
      assert.deepEqual(plan.to, connection.to);
      const center = facilityLocalToWorld(plan, { x: 0, z: 0 }),
        front = facilityLocalToWorld(plan, { x: 0, z: 1 });
      closePoint(
        { x: front.x - center.x, z: front.z - center.z },
        connection.direction,
        `${label} loading apron faces the road`,
      );
      assert.ok(plan.points.length > 1);
      assert.equal(
        plan.renderSegments.length,
        1,
        'Single-tile factories use a compact apron instead of a perimeter ring',
      );
      const start = plan.points[0],
        end = plan.points.at(-1)!;
      close(Math.hypot(end.x - start.x, end.z - start.z), 0.2, `${label} apron length`);
      const pose = lanePose(connection.previous, connection.road, connection.to, 0);
      closePoint(
        end,
        { x: pose.x - state.size / 2, z: pose.z - state.size / 2 },
        `${label} road entry`,
      );
      for (const point of plan.points) {
        close(
          (point.x - start.x) * connection.direction.z -
            (point.z - start.z) * connection.direction.x,
          0,
          `${label} straight loading apron`,
        );
        close(
          sampleFacilityAccessHeight(plan, point.x, point.z)!,
          point.y,
          `${label} paved apron height`,
        );
        assert.ok(point.x >= plan.center.x - 0.5 - 1e-8 && point.x <= plan.center.x + 0.5 + 1e-8);
        assert.ok(point.z >= plan.center.z - 0.5 - 1e-8 && point.z <= plan.center.z + 0.5 + 1e-8);
      }
      assert.equal(
        JSON.stringify(state),
        before,
        'Facing a road is presentation only and must preserve the original save',
      );
      assert.equal(tile.rotation, rotation);
      assert.deepEqual(
        listFacilityServiceRoutes(state),
        [],
        'A factory does not invent an emergency vehicle',
      );
    }
});

test('industrial aprons support small slopes and reject steeper roads instead of creating an impassable ramp', () => {
  for (const side of sides)
    for (const delta of [-1, -0.5, -0.2, 0.2, 0.5, 1]) {
      const { state, tile, width, depth } = fixture('industrial');
      const connection = attachRoad(state, tile, width, depth, side, tile.elevation + delta);
      const plan = requirePlan(state, tile),
        label = `industrial/${side}/${delta}`;
      if (Math.abs(delta) > 0.2) {
        assert.equal(
          plan.connected,
          false,
          `${label} cannot safely fit its height change into a single-tile apron`,
        );
        assert.equal(plan.points.length, 1);
        assert.equal(plan.to, null);
        assert.equal(sampleFacilityAccessHeight(plan, plan.points[0].x, plan.points[0].z), null);
        continue;
      }
      assert.equal(plan.connected, true, `${label} remains usable`);
      close(
        plan.points[0].y,
        tile.elevation + FACILITY_PAVEMENT_HEIGHT,
        `${label} foundation height`,
      );
      close(
        plan.points.at(-1)!.y,
        tile.elevation + delta + FACILITY_PAVEMENT_HEIGHT,
        `${label} road height`,
      );
      for (let i = 1; i < plan.points.length; i++) {
        const before = plan.points[i - 1],
          point = plan.points[i],
          length = Math.hypot(point.x - before.x, point.z - before.z);
        assert.ok(length > 0);
        assert.ok(Math.abs(point.y - before.y) / length < 2.2, `${label} safe vehicle slope`);
        for (const fraction of [0, 0.5, 1]) {
          const x = before.x + (point.x - before.x) * fraction,
            z = before.z + (point.z - before.z) * fraction;
          close(
            sampleFacilityAccessHeight(plan, x, z)!,
            before.y + (point.y - before.y) * fraction,
            `${label} continuous pavement`,
          );
        }
      }
      const end = plan.points.at(-1)!;
      assert.equal(
        sampleFacilityAccessHeight(
          plan,
          end.x + connection.direction.x * 0.001,
          end.z + connection.direction.z * 0.001,
        ),
        null,
        `${label} apron must not place an invisible lip on the road`,
      );
    }
});

test('unbuilt industrial zoning has no factory apron until its first building appears', () => {
  const { state, tile, width, depth } = fixture('industrial');
  attachRoad(state, tile, width, depth, 'east');
  tile.level = 0;
  assert.equal(getFacilityAccess(state, tile), null);
  tile.level = 1;
  const built = requirePlan(state, tile);
  assert.equal(built.connected, true);
  tile.level = 2;
  const developed = requirePlan(state, tile);
  assert.notEqual(developed, built, 'Changes to factory growth invalidate its presentation layout');
  assert.equal(developed.connected, true);
  tile.level = 0;
  assert.equal(
    getFacilityAccess(state, tile),
    null,
    'Removing the building removes the apron immediately',
  );
});

test('larger civic elevation differences produce a safely traversable route or keep the service vehicle parked', () => {
  let connected = 0;
  for (const kind of civicKinds)
    for (const rotation of rotations)
      for (const side of sides)
        for (const delta of [-2, -1, -0.5, 0.5, 1, 2]) {
          const { state, tile, width, depth } = fixture(kind, rotation, 3);
          attachRoad(state, tile, width, depth, side, tile.elevation + delta);
          const plan = requirePlan(state, tile),
            label = `${kind}/${rotation}/${side}/${delta}`;
          assert.ok(
            plan.points.every((point) => Object.values(point).every(Number.isFinite)),
            `${label} finite access plan`,
          );
          if (!plan.connected) {
            assert.equal(
              plan.points.length,
              1,
              `${label} impossible gradients must leave a parked vehicle instead of a partial exit route`,
            );
            for (const route of listFacilityServiceRoutes(state))
              assert.equal(route.connected, false, `${label} emergency dispatch must stay parked`);
            continue;
          }
          connected++;
          close(
            plan.points[0].y,
            tile.elevation + FACILITY_PAVEMENT_HEIGHT,
            `${label} starts on its foundation`,
          );
          close(
            plan.points.at(-1)!.y,
            tile.elevation + delta + FACILITY_PAVEMENT_HEIGHT,
            `${label} reaches the road`,
          );
          for (let i = 0; i < plan.points.length; i++) {
            const point = plan.points[i];
            close(
              sampleFacilityAccessHeight(plan, point.x, point.z)!,
              point.y,
              `${label} pavement matches the route at point ${i}`,
            );
            assert.ok(
              point.x >= plan.center.x - width / 2 - 1e-8 &&
                point.x <= plan.center.x + width / 2 + 1e-8,
              `${label} access stays within its property in x`,
            );
            assert.ok(
              point.z >= plan.center.z - depth / 2 - 1e-8 &&
                point.z <= plan.center.z + depth / 2 + 1e-8,
              `${label} access stays within its property in z`,
            );
            if (!i) continue;
            const before = plan.points[i - 1],
              distance = Math.hypot(point.x - before.x, point.z - before.z);
            if (distance > 1e-10)
              assert.ok(
                Math.abs(point.y - before.y) / distance < 2.2,
                `${label} must never advertise an impassable route`,
              );
            else close(point.y, before.y, `${label} route cannot contain a vertical jump`);
          }
        }
  assert.ok(
    connected > 0,
    'Existing usable access must remain available when testing elevated facilities',
  );
});
