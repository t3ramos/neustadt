import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCity,
  getFootprint,
  recalculate,
  TOOL_DEFS,
} from '../../src/simulation/city-simulation.ts';
import { getPowerLayout } from '../../src/infrastructure/power-layout.ts';
import {
  createPowerGridModel,
  powerServiceModelPlacement,
  powerWirePoints,
} from '../../src/rendering/infrastructure/power.ts';
import { createPathTracingSnapshot } from '../../src/rendering/raytracing.ts';
import {
  getFacilityAccess,
  sampleFacilityAccessHeight,
} from '../../src/buildings/facility-access.ts';
import { createFacilityServiceVehicle } from '../../src/rendering/buildings/models.ts';
import { isPowerServiceDropClear } from '../../src/infrastructure/power-service.ts';
import type { TileKind } from '../../src/domain/types.ts';

function smallGrid() {
  const state = createCity(19, true, 40);
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.elevation = 0;
    tile.level = 0;
    tile.anchor = -1;
    tile.hasPowerLine = false;
    tile.hasPipe = false;
  }
  for (let x = 8; x <= 15; x++) {
    const tile = state.tiles[10 * 40 + x];
    tile.kind = 'road';
    tile.hasPowerLine = true;
  }
  const source = state.tiles[11 * 40 + 8];
  source.kind = 'power';
  source.level = 1;
  const home = state.tiles[11 * 40 + 14];
  home.kind = 'residential';
  home.level = 2;
  recalculate(state);
  return state;
}

test('sagging wire vertices touch both actual insulators and remain below the straight span', () => {
  const start = new THREE.Vector3(1, 3.385, 4),
    end = new THREE.Vector3(3, 1.245, 4.36);
  const points = powerWirePoints(start, end, 0.15);
  assert.equal(points.length, 7);
  assert.ok(points[0].equals(start));
  assert.ok(points.at(-1)!.equals(end));
  for (let i = 1; i < points.length - 1; i++) {
    const t = i / (points.length - 1),
      straight = start.clone().lerp(end, t);
    assert.ok(points[i].y < straight.y);
    assert.equal(points[i].x, straight.x);
    assert.equal(points[i].z, straight.z);
  }
  assert.ok(Math.abs(points[3].y - (start.y + end.y) / 2 + 0.15) < 1e-9);
});

test('connected poles, meters and wires merge into a small finite PBR mesh set', () => {
  const state = smallGrid(),
    layout = getPowerLayout(state),
    group = createPowerGridModel(state, layout);
  assert.ok(layout.services.some((s) => state.tiles[s.building].kind === 'power'));
  assert.ok(!layout.services.some((s) => state.tiles[s.building].kind === 'residential'));
  assert.equal(
    layout.services.length,
    1,
    'Only the large power facility receives a meter and drop',
  );
  assert.deepEqual(group.userData.utilityCounts, {
    poles: layout.poles.length,
    spans: layout.spans.length,
    services: layout.services.length,
  });
  assert.ok(group.children.length <= 8);
  assert.ok(group.children.length >= 4);
  for (const item of group.children) {
    assert.ok(item instanceof THREE.Mesh);
    assert.ok(item.material instanceof THREE.MeshStandardMaterial);
    const positions = item.geometry.getAttribute('position');
    assert.ok(positions.count > 0);
    assert.ok(item.geometry.getAttribute('normal'));
    assert.ok(item.geometry.getAttribute('uv'));
    for (const value of positions.array) assert.ok(Number.isFinite(value));
    item.geometry.computeBoundingBox();
    assert.ok(item.geometry.boundingBox!.min.y >= -0.002);
  }
});

test('new electricity geometry survives the actual ray-tracing snapshot path', async () => {
  const state = smallGrid(),
    scene = new THREE.Scene();
  scene.add(createPowerGridModel(state, getPowerLayout(state)));
  const snapshot = await createPathTracingSnapshot(scene, false);
  const meshes = snapshot.scene.children.filter((o) => o instanceof THREE.Mesh);
  assert.ok(meshes.length >= 4 && meshes.length <= 8);
  for (const mesh of meshes) {
    assert.ok(mesh.geometry.getAttribute('normal'));
    assert.equal(mesh.geometry.getAttribute('color').itemSize, 4);
  }
  snapshot.dispose();
});

test('facility meters stay on the inner plinth and raised service wires clear every private access lane', () => {
  const fireEngine = createFacilityServiceVehicle('firetruck');
  const vehicleHeight = new THREE.Box3().setFromObject(fireEngine).getSize(new THREE.Vector3()).y;
  assert.ok(vehicleHeight > 0.3 && vehicleHeight < 0.4);
  const kinds = Object.entries(TOOL_DEFS)
    .filter(([, definition]) => definition?.footprint)
    .map(([kind]) => kind as TileKind);
  for (const kind of kinds)
    for (const rotation of [0, 1, 2, 3] as const)
      for (const elevation of [0, 0.5, 2]) {
        const state = createCity(19, true, 40);
        for (const tile of state.tiles)
          Object.assign(tile, {
            kind: 'empty',
            elevation: 0,
            level: 0,
            anchor: -1,
            hasPowerLine: false,
            hasPipe: false,
          });
        const x = 12,
          z = 12,
          id = z * state.size + x;
        const nominal = TOOL_DEFS[kind]!.footprint!,
          [width, depth] = rotation % 2 ? [nominal[1], nominal[0]] : nominal;
        for (let dz = 0; dz < depth; dz++)
          for (let dx = 0; dx < width; dx++) {
            Object.assign(state.tiles[(z + dz) * state.size + x + dx], {
              kind,
              level: 1,
              anchor: id,
              rotation,
              elevation,
            });
          }
        // A ground mast feeds the left edge; the full adjacent street makes the
        // facility reserve its new unscaled private driveway and sloped apron.
        const sourceId = z * state.size + x - 5;
        for (let dz = 0; dz < 4; dz++)
          for (let dx = 0; dx < 4; dx++) {
            Object.assign(state.tiles[(z + dz) * state.size + x - 5 + dx], {
              kind: 'power',
              level: 1,
              anchor: sourceId,
              rotation: 0,
              elevation,
            });
          }
        state.tiles[(z + 1) * state.size + x - 1].hasPowerLine = true;
        state.tiles[(z + 1) * state.size + x - 1].elevation = elevation;
        for (let dx = 0; dx < width; dx++)
          state.tiles[(z + depth) * state.size + x + dx].kind = 'road';
        recalculate(state);
        const before = JSON.stringify(state),
          layout = getPowerLayout(state);
        const service = layout.services.find((service) => service.building === id)!;
        assert.ok(
          service,
          `${kind} rotation ${rotation} needs its existing large-facility service`,
        );
        const powerPole = layout.poles.find((pole) => pole.id === service.pole)!;
        const offset = state.tiles[powerPole.id].kind === 'road' ? 0.86 : 0.5;
        const pole = new THREE.Vector3(
          powerPole.x - state.size / 2 + offset,
          powerPole.elevation,
          powerPole.z - state.size / 2 + offset,
        );
        const placement = powerServiceModelPlacement(state, service, pole),
          plan = getFacilityAccess(state, state.tiles[id])!;
        assert.equal(plan.connected, true);
        assert.equal(placement.driveway, true);
        assert.equal(
          placement.overhead,
          true,
          `${kind} rotation ${rotation} retains its visible service cable`,
        );
        const cabinet = placement.cabinet;
        assert.ok(
          Math.abs(cabinet.y - plan.baseY - 0.052) < 1e-9,
          'The footing rests on the new visible plinth',
        );
        const source = ['power', 'wind', 'solar'].includes(kind);
        const radius =
          Math.hypot((source ? 0.2 : 0.105) + 0.055, (source ? 0.16 : 0.07) + 0.055) / 2;
        for (const dx of [-radius, radius])
          for (const dz of [-radius, radius]) {
            assert.equal(
              sampleFacilityAccessHeight(plan, cabinet.x + dx, cabinet.z + dz),
              null,
              `${kind} rotation ${rotation} cannot put any corner of its meter footing in the driveway`,
            );
          }
        const footprintIds = new Set(
          getFootprint(state, state.tiles[id]).map((point) => point.z * state.size + point.x),
        );
        assert.equal(
          isPowerServiceDropClear(
            state,
            state.tiles[service.pole],
            [cabinet.x + state.size / 2, cabinet.z + state.size / 2],
            footprintIds,
            (tile) =>
              !!TOOL_DEFS[tile.kind]?.footprint ||
              (['residential', 'commercial', 'industrial'].includes(tile.kind) && tile.level > 0),
          ),
          true,
          'Moving the visible cabinet cannot introduce a public-road crossing',
        );
        for (const point of powerWirePoints(placement.cableStart, placement.contact, 0.055, 256)) {
          const surface = sampleFacilityAccessHeight(plan, point.x, point.z);
          if (surface === null) continue;
          assert.ok(
            point.y - 0.007 >= surface + vehicleHeight + 0.1,
            `${kind} rotation ${rotation} at elevation ${elevation} leaves insufficient vehicle clearance`,
          );
        }
        assert.equal(
          JSON.stringify(state),
          before,
          'Render placement cannot change block supply or saved infrastructure',
        );
      }
});

test('an inset facility feed stays clear of a raised or lowered entrance ramp from a real street curb', () => {
  let slopedSamples = 0;
  for (const rotation of [0, 1, 2, 3] as const)
    for (const [facilityHeight, streetHeight] of [
      [0, 2],
      [2, 0],
      [0.5, 0],
      [0, 0.5],
    ]) {
      const state = createCity(21, true, 40);
      for (const tile of state.tiles)
        Object.assign(tile, {
          kind: 'empty',
          elevation: 0,
          level: 0,
          anchor: -1,
          hasPowerLine: false,
          hasPipe: false,
        });
      const id = 12 * 40 + 12;
      for (let z = 12; z <= 13; z++)
        for (let x = 12; x <= 13; x++)
          Object.assign(state.tiles[z * 40 + x], {
            kind: 'police',
            level: 1,
            anchor: id,
            rotation,
            elevation: facilityHeight,
          });
      for (let z = 8; z <= 11; z++)
        for (let x = 2; x <= 5; x++)
          Object.assign(state.tiles[z * 40 + x], {
            kind: 'power',
            level: 1,
            anchor: 8 * 40 + 2,
            rotation: 0,
            elevation: streetHeight,
          });
      for (let x = 6; x <= 17; x++)
        Object.assign(state.tiles[11 * 40 + x], {
          kind: 'road',
          hasPowerLine: true,
          elevation: streetHeight,
        });
      recalculate(state);
      const layout = getPowerLayout(state),
        service = layout.services.find((service) => service.building === id)!;
      assert.ok(service);
      const pole = layout.poles.find((pole) => pole.id === service.pole)!;
      assert.equal(state.tiles[pole.id].kind, 'road');
      const placement = powerServiceModelPlacement(
        state,
        service,
        new THREE.Vector3(pole.x - 20 + 0.86, pole.elevation, pole.z - 20 + 0.86),
      );
      assert.equal(placement.overhead, true);
      const plan = getFacilityAccess(state, state.tiles[id])!;
      for (const point of powerWirePoints(placement.cableStart, placement.contact, 0.055, 512)) {
        const surface = sampleFacilityAccessHeight(plan, point.x, point.z);
        if (surface === null) continue;
        if (Math.abs(surface - plan.baseY - 0.052) > 0.01) slopedSamples++;
        assert.ok(
          point.y - 0.007 >= surface + 0.434,
          `Public-curb feed rotation ${rotation}, terrain ${facilityHeight}/${streetHeight} intersects the private entrance ramp`,
        );
      }
    }
  assert.ok(slopedSamples > 50, 'The check must actually cross sloped driveway geometry');
});
