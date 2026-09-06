import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { createTileModel } from '../../src/rendering/buildings/models';
import {
  ROAD_SURFACE_HEIGHT,
  roadPaintAt,
  roadStopMask,
} from '../../src/rendering/infrastructure/road-surface';
import { warpRoadModel } from '../../src/rendering/infrastructure/roads';
import { sampleRoadHeight } from '../../src/rendering/infrastructure/roads.ts';
import { buildRoadNetwork, type RoadJunction } from '../../src/traffic/network.ts';
import { createTrafficController, STOP_LINE_OFFSET } from '../../src/traffic/controller.ts';
import {
  createTrafficSignals,
  getTrafficSignalFixture,
} from '../../src/rendering/infrastructure/signals.ts';
import type { CityState } from '../../src/domain/types.ts';

function city(size = 40): CityState {
  const state = createCity(571, true, size);
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.elevation = 0;
  }
  return state;
}
function cross(state: CityState, x = 10, z = 10) {
  for (let d = -3; d <= 3; d++) {
    state.tiles[z * state.size + x + d].kind = 'road';
    state.tiles[(z + d) * state.size + x].kind = 'road';
  }
  const network = buildRoadNetwork(state);
  network.junctions.sort((a, b) => Number(b.signalized) - Number(a.signalized));
  return network;
}
function mesh(helper: ReturnType<typeof createTrafficSignals>, name: string): THREE.InstancedMesh {
  const object = helper.group.getObjectByName(`traffic-signal-${name}`);
  assert.ok(object instanceof THREE.InstancedMesh);
  return object;
}
function instancePosition(batch: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  batch.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

test('all four inbound approaches receive a head on their own right curb facing the driver', (t) => {
  const state = city(),
    network = cross(state),
    junction = network.junctions[0];
  const helper = createTrafficSignals(state, network.junctions);
  t.after(() => helper.dispose());
  assert.equal(helper.getDebug().count, 4);
  assert.deepEqual(helper.getDebug().aspects, { red: 4, yellow: 0, green: 0 });
  for (let index = 0; index < junction.approaches.length; index++) {
    const approach = junction.approaches[index],
      fixture = getTrafficSignalFixture(state, approach)!;
    const dx = fixture.mast.x - (approach.entry.x + 0.5 - state.size / 2);
    const dz = fixture.mast.z - (approach.entry.z + 0.5 - state.size / 2);
    assert.ok(Math.abs(dx * -approach.direction.z + dz * approach.direction.x - 0.465) < 1e-9);
    assert.ok(Math.abs(dx * approach.direction.x + dz * approach.direction.z + 0.465) < 1e-9);
    assert.ok(
      Math.abs(dx) - 0.055 / 2 > 0.335 && Math.abs(dz) - 0.055 / 2 > 0.335,
      'The entire footing clears every asphalt arm',
    );
    assert.ok(
      Math.abs(dx) + 0.055 / 2 < 0.5 && Math.abs(dz) + 0.055 / 2 < 0.5,
      'No footing extends into an adjacent facility driveway',
    );
    assert.deepEqual(fixture.facing, { x: -approach.direction.x, z: -approach.direction.z });
    const pole = instancePosition(mesh(helper, 'poles'), index);
    assert.ok(Math.abs(pole.x - fixture.mast.x) < 1e-6 && Math.abs(pole.z - fixture.mast.z) < 1e-6);
    const lensPosition = instancePosition(mesh(helper, 'red-lenses'), index);
    assert.ok(
      (lensPosition.x - fixture.head.x) * fixture.facing.x +
        (lensPosition.z - fixture.head.z) * fixture.facing.z >
        0.03,
    );
    const lensMatrix = new THREE.Matrix4();
    mesh(helper, 'red-lenses').getMatrixAt(index, lensMatrix);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(lensMatrix);
    assert.ok(normal.x * fixture.facing.x + normal.z * fixture.facing.z > 0.99999);
  }
});

test('rendered red, amber, and green always match the controller, including all-red clearance', (t) => {
  const state = city(),
    network = cross(state),
    controller = createTrafficController(network);
  const helper = createTrafficSignals(state, network.junctions);
  t.after(() => helper.dispose());
  const verify = () => {
    const signals = controller.signalStates();
    helper.setSignals(signals);
    for (const fixture of helper.getDebug().positions)
      assert.equal(
        fixture.color,
        signals.find((signal) => signal.approachId === fixture.approachId)?.color,
      );
    for (const color of ['red', 'yellow', 'green'] as const) {
      const expected = signals.filter((signal) => signal.color === color).length;
      assert.equal(mesh(helper, `${color}-lenses`).count, expected);
      assert.equal(helper.getDebug().aspects[color], expected);
    }
  };
  verify();
  assert.deepEqual(helper.getDebug().aspects, { red: 3, yellow: 0, green: 1 });
  controller.update(5, []);
  verify();
  assert.deepEqual(helper.getDebug().aspects, { red: 3, yellow: 1, green: 0 });
  controller.update(1, []);
  verify();
  assert.deepEqual(helper.getDebug().aspects, { red: 4, yellow: 0, green: 0 });
  controller.update(0.6, []);
  verify();
  assert.deepEqual(helper.getDebug().aspects, { red: 3, yellow: 0, green: 1 });
  helper.setSignals([]);
  assert.deepEqual(
    helper.getDebug().aspects,
    { red: 4, yellow: 0, green: 0 },
    'Missing state must fail to red instead of retaining a stale green',
  );
});

test('stop lines are painted on the asphalt behind crosswalks, including nonplanar decks', (t) => {
  const state = city(),
    network = cross(state);
  for (const tile of state.tiles)
    if (tile.kind === 'road') tile.elevation = tile.x * 0.5 + tile.z * 0.25;
  const helper = createTrafficSignals(state, network.junctions);
  t.after(() => helper.dispose());
  assert.equal(helper.group.getObjectByName('traffic-signal-stop-bars'), undefined);
  for (const approach of network.junctions[0].approaches) {
    const fixture = getTrafficSignalFixture(state, approach)!,
      tile = state.tiles[approach.from.z * state.size + approach.from.x];
    const localX = fixture.stopBar.x - (tile.x + 0.5 - state.size / 2),
      localZ = fixture.stopBar.z - (tile.z + 0.5 - state.size / 2);
    assert.equal(roadPaintAt(localX, localZ, 15, roadStopMask(state, tile)), 'crosswalk');
    assert.equal(
      fixture.stopBar.y,
      sampleRoadHeight(state, fixture.stopBar.x, fixture.stopBar.z) + ROAD_SURFACE_HEIGHT,
    );
    const model = createTileModel(tile, state);
    warpRoadModel(model, tile, state);
    model.position.set(
      tile.x + 0.5 - state.size / 2,
      Math.max(0, tile.elevation),
      tile.z + 0.5 - state.size / 2,
    );
    model.updateMatrixWorld(true);
    t.after(() =>
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      }),
    );
    const hit = new THREE.Raycaster(
      new THREE.Vector3(fixture.stopBar.x, 30, fixture.stopBar.z),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(model, true)[0];
    assert.ok(hit);
    assert.ok(Math.abs(hit.point.y - fixture.stopBar.y) < 1e-5);
    const centerX = approach.entry.x + 0.5 - state.size / 2,
      centerZ = approach.entry.z + 0.5 - state.size / 2;
    const setback =
      -(fixture.stopBar.x - centerX) * approach.direction.x -
      (fixture.stopBar.z - centerZ) * approach.direction.z;
    assert.ok(Math.abs(setback - (STOP_LINE_OFFSET - 0.025)) < 1e-9);
  }
});

test('terrain and demolition updates refresh fixtures and drop removed approach lights', (t) => {
  const state = city(),
    network = cross(state),
    helper = createTrafficSignals(state, network.junctions);
  t.after(() => helper.dispose());
  const initial = helper.getDebug().positions.map((p) => p.y);
  state.tiles[10 * state.size + 10].elevation = 3;
  helper.update(state, network.junctions);
  assert.ok(helper.getDebug().positions.every((p, i) => p.y > initial[i]));
  for (const approach of network.junctions[0].approaches) {
    const fixture = getTrafficSignalFixture(state, approach)!;
    assert.ok(
      Math.abs(fixture.mast.y - sampleRoadHeight(state, fixture.mast.x, fixture.mast.z) - 0.045) <
        1e-9,
    );
  }
  state.tiles[10 * state.size + 10].kind = 'empty';
  helper.update(state, network.junctions);
  assert.equal(
    helper.getDebug().count,
    0,
    'Even a stale network cannot render on a demolished road',
  );
  assert.equal(mesh(helper, 'poles').count, 0);
  assert.equal(mesh(helper, 'red-lenses').count, 0);
  const bad = { ...network.junctions[0].approaches[0], direction: { x: 1, z: 1 } };
  assert.equal(getTrafficSignalFixture(state, bad), null);
});

test('protected narrow bends stay unlit and topology changes can remove existing signals', (t) => {
  const state = city(),
    network = cross(state),
    helper = createTrafficSignals(state, network.junctions);
  t.after(() => helper.dispose());
  assert.equal(helper.getDebug().count, 4);
  network.junctions[0].signalized = false;
  helper.update(state, network.junctions);
  assert.equal(helper.getDebug().count, 0);
  assert.equal(helper.group.getObjectByName('traffic-signal-stop-bars'), undefined);
  network.junctions[0].signalized = true;
  helper.update(state, network.junctions);
  assert.equal(helper.getDebug().count, 4);
});

test('large 128-tile maps use nine shared instanced draws and zero point lights', (t) => {
  const state = city(128);
  for (const tile of state.tiles)
    if (
      (tile.x % 4 === 0 || tile.z % 4 === 0) &&
      tile.x > 0 &&
      tile.z > 0 &&
      tile.x < 127 &&
      tile.z < 127
    )
      tile.kind = 'road';
  const network = buildRoadNetwork(state),
    helper = createTrafficSignals(state, network.junctions);
  t.after(() => helper.dispose());
  assert.ok(helper.getDebug().count > 3000);
  assert.equal(helper.getDebug().drawCalls, 9);
  assert.equal(helper.getDebug().pointLights, 0);
  assert.ok(helper.group.children.every((object) => object instanceof THREE.InstancedMesh));
  assert.equal(helper.group.children.length, 9);
  assert.equal(
    helper.getDebug().positions.length,
    128,
    'Diagnostics stay bounded as the map grows',
  );
  assert.equal(
    new Set(helper.group.children.map((object) => (object as THREE.InstancedMesh).geometry)).size,
    4,
  );
});

test('unchanged phases reuse buffers, growth reuses materials, and disposal releases owned resources once', () => {
  const state = city(),
    network = cross(state),
    controller = createTrafficController(network);
  const helper = createTrafficSignals(state, network.junctions),
    parent = new THREE.Scene();
  parent.add(helper.group);
  helper.setSignals(controller.signalStates());
  const red = mesh(helper, 'red-lenses'),
    version = red.instanceMatrix.version;
  helper.setSignals(controller.signalStates());
  helper.update(state, network.junctions);
  assert.equal(
    red.instanceMatrix.version,
    version,
    'An unchanged frame must not re-upload light geometry',
  );
  const initialPole = mesh(helper, 'poles'),
    originalMaterial = initialPole.material;
  let initialDisposals = 0;
  initialPole.addEventListener('dispose', () => initialDisposals++);
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  for (const child of helper.group.children as THREE.InstancedMesh[]) {
    resources.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material])
      resources.add(material);
  }
  const disposed = new Map<object, number>();
  for (const resource of resources)
    resource.addEventListener('dispose', () =>
      disposed.set(resource, (disposed.get(resource) ?? 0) + 1),
    );
  let junctions: RoadJunction[] = [];
  for (let z = 5; z < 30; z += 5)
    for (let x = 5; x < 30; x += 5) junctions = cross(state, x, z).junctions;
  helper.update(state, junctions);
  assert.notEqual(mesh(helper, 'poles'), initialPole);
  assert.equal(initialDisposals, 1);
  assert.equal(mesh(helper, 'poles').material, originalMaterial);
  assert.equal(disposed.size, 0);
  helper.dispose();
  helper.dispose();
  helper.update(state, junctions);
  helper.setSignals(controller.signalStates());
  assert.equal(parent.children.length, 0);
  assert.equal(helper.group.children.length, 0);
  assert.equal(disposed.size, resources.size);
  assert.ok([...disposed.values()].every((count) => count === 1));
  assert.equal(helper.getDebug().count, 0);
});
