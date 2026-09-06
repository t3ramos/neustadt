import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createFacilityActors, createTileModel, getModelFootprint, setModelNightBlend, setModelWet, updateFacilityActors,
  createFacilityServiceVehicle,
} from '../src/models.ts';
import { getFacilityAccess, sampleFacilityAccessHeight } from '../src/facility-access.ts';
import { createCity, TOOL_DEFS } from '../src/simulation.ts';
import { createPathTracingSnapshot } from '../src/raytracing.ts';
import type { Tile, TileKind } from '../src/types.ts';

const state = createCity(81, true, 40);
const facilityKinds: TileKind[] = [
  'power', 'waterpump', 'police', 'fire', 'hospital', 'school', 'university',
  'stadium', 'airport', 'seaport', 'wind', 'solar', 'recycling',
];

function tile(kind: TileKind, extra: Partial<Tile> = {}): Tile {
  return {
    ...state.tiles[12 * state.size + 12],
    x: 12, z: 12, kind, level: 1, variation: 0, elevation: 0,
    anchor: -1, rotation: 0, fire: 0, ...extra,
  };
}

function boundsOf(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function assertInFootprint(object: THREE.Object3D, width: number, depth: number, label: string): void {
  const bounds = boundsOf(object), epsilon = .001;
  assert.ok(!bounds.isEmpty(), `${label} needs visible geometry`);
  assert.ok(bounds.min.x >= -.5 - epsilon && bounds.max.x <= width - .5 + epsilon,
    `${label} crosses its X footprint: ${bounds.min.x} .. ${bounds.max.x}`);
  assert.ok(bounds.min.z >= -.5 - epsilon && bounds.max.z <= depth - .5 + epsilon,
    `${label} crosses its Z footprint: ${bounds.min.z} .. ${bounds.max.z}`);
  assert.ok(bounds.min.y >= -epsilon, `${label} has geometry below its ground plane`);
}

test('every large facility matches its construction footprint in all four rotations', () => {
  for (const kind of facilityKinds) {
    const nominal = TOOL_DEFS[kind]?.footprint;
    assert.ok(nominal, `${kind} needs a construction footprint`);
    for (const rotation of [0, 1, 2, 3] as const) {
      const expected: [number, number] = rotation % 2 ? [nominal[1], nominal[0]] : [nominal[0], nominal[1]];
      const dimensions = getModelFootprint(kind, rotation);
      assert.deepEqual(dimensions, expected, `${kind} rotation ${rotation} must agree with construction`);
      const model = createTileModel(tile(kind, { rotation }), state);
      assertInFootprint(model, dimensions[0], dimensions[1], `${kind} rotation ${rotation}`);
      const size = boundsOf(model).getSize(new THREE.Vector3());
      // Prevent a regression to the old single-tile models inside a big preview.
      assert.ok(size.x > dimensions[0] * .8 && size.z > dimensions[1] * .8,
        `${kind} should occupy its actual multi-tile site`);
    }
  }
});

function meshParts(object: THREE.Object3D, width: number, height: number, depth: number, geometryType = 'BoxGeometry'): THREE.Mesh[] {
  object.updateMatrixWorld(true);
  const matches: THREE.Mesh[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.geometry.type !== geometryType) return;
    const size = boundsOf(child).getSize(new THREE.Vector3());
    if ([size.x - width, size.y - height, size.z - depth].every(delta => Math.abs(delta) < .0001)) matches.push(child);
  });
  return matches;
}

function cylindersAt(object: THREE.Object3D, height: number, x: number, z: number): THREE.Mesh[] {
  const matches: THREE.Mesh[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.geometry.type !== 'CylinderGeometry') return;
    const bounds = boundsOf(child), center = bounds.getCenter(new THREE.Vector3());
    if (Math.abs(center.x - x) < .0001 && Math.abs(center.z - z) < .0001
      && Math.abs(bounds.max.y - bounds.min.y - height) < .0001) matches.push(child);
  });
  return matches;
}

function geometrySignature(object: THREE.Object3D): string {
  object.updateMatrixWorld(true);
  const parts: string[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (materials.every(material => material.userData.buildingWindowLight)) return;
    const bounds = boundsOf(child);
    parts.push([child.geometry.type, ...bounds.min.toArray(), ...bounds.max.toArray()]
      .map(value => typeof value === 'number' ? value.toFixed(4) : value).join(','));
  });
  return parts.sort().join(';');
}

test('original residential densities retain cottage, duplex and compact apartment proportions', () => {
  for (let variation = 0; variation < 8; variation++) {
    const cottage = createTileModel(tile('residential', { level: 1, variation }), state);
    assert.equal(meshParts(cottage, .49, .42, .5).length, 1, 'the cottage needs its original solid wall body');
    assert.equal(meshParts(cottage, .59, .23, .61, 'BufferGeometry').length, 1, 'the cottage keeps its pitched roof');
    const duplex = createTileModel(tile('residential', { level: 2, variation }), state);
    assert.equal(meshParts(duplex, .34, .75, .54).length, 2, 'the duplex needs two original attached bodies');
    assert.equal(meshParts(duplex, .37, .18, .61, 'BufferGeometry').length, 2, 'both duplex homes keep pitched roofs');
    const apartment = createTileModel(tile('residential', { level: 3, variation }), state);
    const mature = createTileModel(tile('residential', { level: 4, variation }), state);
    assert.equal(meshParts(apartment, .66, 1.05 + (variation % 4) * .19, .61).length, 1,
      'apartments keep the original moderate height and footprint');
    assert.equal(geometrySignature(mature), geometrySignature(apartment),
      'level 4 keeps the original apartment design rather than introducing a prestige tower');
  }
});

test('original commercial densities retain low shops, stone offices and two-part towers', () => {
  for (let variation = 0; variation < 8; variation++) {
    const shop = createTileModel(tile('commercial', { level: 1, variation }), state);
    assert.equal(meshParts(shop, .74, .42, .61).length, 1, 'the original shop retains its solid low-rise body');
    assert.equal(meshParts(shop, .78, .04, .24).length, 1, 'the shop keeps its projecting awning');
    assert.equal(meshParts(shop, .10, .018, .22).length, 4, 'the awning retains four colored stripes');
    const offices = createTileModel(tile('commercial', { level: 2, variation }), state);
    assert.equal(meshParts(offices, .69, .85 + (variation % 3) * .19, .66).length, 1,
      'the original office block has solid walls at its original dimensions');
    const tower = createTileModel(tile('commercial', { level: 3, variation }), state);
    const mature = createTileModel(tile('commercial', { level: 4, variation }), state);
    const height = 2.6 + (variation % 6) * .29;
    const primary = meshParts(tower, .54, height, .59);
    const wing = meshParts(tower, .29, height * .66, .52);
    assert.equal(primary.length, 1, 'the original tower needs its main shaft');
    assert.equal(wing.length, 1, 'the original tower needs its lower side wing');
    assert.equal(meshParts(tower, .554, .026, .606).length, 6, 'the tower keeps its six narrow floor bands');
    assert.equal(cylindersAt(tower, .40, -.10, -.07).length, variation % 2 === 0 ? 1 : 0,
      'the original alternating tower antenna remains intact');
    const mainCenter = boundsOf(primary[0]).getCenter(new THREE.Vector3());
    const wingCenter = boundsOf(wing[0]).getCenter(new THREE.Vector3());
    assert.ok(Math.abs(mainCenter.x + .1) < .0001 && Math.abs(mainCenter.z + .07) < .0001,
      'the main tower retains its original offset');
    assert.ok(Math.abs(wingCenter.x - .24) < .0001 && Math.abs(wingCenter.z - .1) < .0001,
      'the lower wing retains its original offset');
    assert.equal(geometrySignature(mature), geometrySignature(tower),
      'levels 3 and 4 share the original commercial tower');
  }
});

test('original factories retain a level-scaled chimney in the established location', () => {
  for (const level of [1, 2, 3, 4]) {
    const factory = createTileModel(tile('industrial', { level }), state);
    assert.equal(meshParts(factory, .22, .15, .65, 'BufferGeometry').length, 3,
      `factory level ${level} needs its three sawtooth roof sections`);
    const chimneys = cylindersAt(factory, .65 + level * .18, .31, -.23);
    assert.equal(chimneys.length, 1, `factory level ${level} needs its original chimney`);
    assertInFootprint(factory, 1, 1, `factory level ${level}`);
  }
});

test('trees have rounded detailed canopies while keeping instanced forest geometry within budget', () => {
  for (let variation = 0; variation < 4; variation++) {
    const model = createTileModel(tile('tree', { variation }), state);
    let triangles = 0, roundedCanopies = 0;
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3;
      if (['SphereGeometry', 'LatheGeometry'].includes(child.geometry.type)) roundedCanopies++;
    });
    assert.ok(roundedCanopies > 0, `tree species ${variation} needs a rounded canopy`);
    assert.ok(triangles >= 240 && triangles <= 600, `tree tile ${variation} exceeds its 240–600 triangle budget: ${triangles}`);
    assertInFootprint(model, 1, 1, `tree species ${variation}`);
  }
});

function actorTransforms(object: THREE.Object3D): number[] {
  object.updateMatrixWorld(true);
  const values: number[] = [];
  object.traverse(child => values.push(...child.matrixWorld.elements));
  return values;
}

test('facility actors animate with a progressing clock, freeze with a paused clock, and remain finite', () => {
  const actorKinds: TileKind[] = ['wind', 'stadium', 'airport', 'seaport'];
  const localState = { ...state, speed: 1 as 0 | 1 | 2 | 3 };
  for (const kind of actorKinds) {
    const actors = createFacilityActors(tile(kind, { rotation: 1 }), localState);
    assert.ok(actors, `${kind} needs its visible action`);
    updateFacilityActors(actors, 12, localState);
    const beforePause = actorTransforms(actors);
    localState.speed = 0;
    updateFacilityActors(actors, 12, localState);
    updateFacilityActors(actors, 12, localState);
    assert.deepEqual(actorTransforms(actors), beforePause, `${kind} moved with a frozen simulation clock`);
    localState.speed = 1;
    updateFacilityActors(actors, 13, localState);
    assert.notDeepEqual(actorTransforms(actors), beforePause, `${kind} did not resume animation`);
    // Include each flight-path transition, a full loop, and a large elapsed value.
    for (const elapsed of [0, 23.4, 30.16, 45.24, 51.999, 52, 10000]) {
      updateFacilityActors(actors, elapsed, localState);
      assert.ok(actorTransforms(actors).every(Number.isFinite), `${kind} has invalid transforms at ${elapsed}s`);
    }
  }
});

test('only a facility anchor creates actors; follower cells and regular lots do not duplicate them', () => {
  const anchor = tile('stadium');
  anchor.anchor = anchor.z * state.size + anchor.x;
  assert.ok(createFacilityActors(anchor, state));
  assert.equal(createFacilityActors({ ...anchor, x: anchor.x + 1 }, state), null);
  assert.equal(createFacilityActors(tile('residential'), state), null);
  assert.equal(createFacilityActors(tile('power'), state), null);
  for (const kind of ['fire', 'police', 'hospital'] as const) {
    assert.equal(createFacilityActors(tile(kind), state), null,
      `${kind} vehicles must come from the real road fleet, not a disconnected animation`);
  }
});

test('connected facilities reserve an unscaled access ring and their visible ramp matches its shared height sampler', () => {
  for (const kind of facilityKinds) for (const rotation of [0, 1, 2, 3] as const) {
    const localState = createCity(81, true, 40);
    for (const cell of localState.tiles) Object.assign(cell, { kind: 'empty', level: 0, elevation: 0, anchor: -1 });
    const [width, depth] = getModelFootprint(kind, rotation), x = 12, z = 12, anchor = z * localState.size + x;
    for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) {
      Object.assign(localState.tiles[(z + dz) * localState.size + x + dx], { kind, level: 1, rotation, anchor, elevation: .5 });
    }
    for (let dx = -1; dx <= width; dx++) localState.tiles[(z + depth) * localState.size + x + dx].kind = 'road';
    const rootTile = localState.tiles[anchor], plan = getFacilityAccess(localState, rootTile)!;
    assert.equal(plan.connected, true, `${kind} rotation ${rotation} needs an adjacent street connection`);
    const model = createTileModel(rootTile, localState), content = model.getObjectByName('facility-content');
    assert.ok(content, 'connected building must leave space for its driveway');
    assert.equal(content.scale.x, plan.contentScale.x);
    assert.equal(content.scale.z, plan.contentScale.z);
    let pavement = 0, foundation = 0;
    model.traverse(part => {
      if (!(part instanceof THREE.Mesh) || !part.userData.drivingSurface) return;
      if (part.name === 'facility-access-paving') pavement++;
      else if (part.name === 'facility-foundation-surface') foundation++;
      else return;
      assert.equal(part.parent, model, 'road and foundation cannot shrink with the building');
      const positions = part.geometry.getAttribute('position');
      for (let i = 0; i < part.geometry.userData.surfaceVertexCount; i++) {
        const wx = positions.getX(i) + x - localState.size / 2 + .5;
        const wz = positions.getZ(i) + z - localState.size / 2 + .5;
        const expected = sampleFacilityAccessHeight(plan, wx, wz) ?? plan.baseY + .052;
        assert.ok(Math.abs(positions.getY(i) + plan.baseY - expected) < 2e-5,
          `${kind} rotation ${rotation} leaves a ${positions.getY(i) + plan.baseY - expected} ledge above the drive at ${wx},${wz}`);
      }
    });
    assert.ok(pavement >= 5, 'four perimeter lanes and the gate must meet the street');
    assert.equal(foundation, 1, 'the foundation itself must follow the ramp');
  }
});

test('road-going emergency models have correct forward axes and complete collision dimensions', () => {
  for (const kind of ['firetruck', 'ambulance', 'police'] as const) {
    const car = createFacilityServiceVehicle(kind), bounds = boundsOf(car), size = bounds.getSize(new THREE.Vector3());
    assert.equal(car.userData.vehicleForward, '+Z');
    assert.equal(car.userData.vehicleKind, kind);
    assert.ok(car.userData.vehicleLabel);
    assert.deepEqual(car.position.toArray(), [0, 0, 0]);
    assert.ok(Math.abs(bounds.min.y) < 1e-8, 'the root must be the tire contact plane');
    assert.ok(Math.abs(car.userData.vehicleDimensions.width - size.x) < 1e-8);
    assert.ok(Math.abs(car.userData.vehicleDimensions.length - size.z) < 1e-8);
    assert.ok(Math.abs(car.userData.vehicleDimensions.height - bounds.max.y) < 1e-8);
    assert.ok(car.userData.vehicleDimensions.wheelBase > 0 && car.userData.vehicleDimensions.mass > 0);
    assert.ok(car.userData.collisionHalfLength >= Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
  }
});

test('a factory faces its actual street and the selected gate opens the curb without a fake intersection', () => {
  for (const [dx, dz, rotation] of [[0, 1, 0], [-1, 0, 1], [0, -1, 2], [1, 0, 3]]) {
    const localState = createCity(81, true, 40);
    for (const cell of localState.tiles) Object.assign(cell, { kind: 'empty', level: 0, elevation: 0, anchor: -1 });
    const factory = localState.tiles[12 * localState.size + 12];
    Object.assign(factory, { kind: 'industrial', level: 2, rotation: 0, elevation: .1, variation: 0 });
    const road = localState.tiles[(12 + dz) * localState.size + 12 + dx];
    road.kind = 'road';
    const continuation = localState.tiles[(12 + dz + (dx ? 1 : 0)) * localState.size + 12 + dx + (dz ? 1 : 0)];
    continuation.kind = 'road';
    const plan = getFacilityAccess(localState, factory)!;
    assert.ok(plan?.connected, `factory must connect on side ${dx},${dz}`);
    assert.equal(plan.rotation, rotation);
    assert.equal(factory.rotation, 0, 'visual street orientation must not rewrite the saved lot');
    const model = createTileModel(factory, localState), content = model.getObjectByName('facility-content')!;
    assert.ok(content);
    assert.equal(content.scale.z, .73);
    assert.equal(content.position.z, -.20);
    assert.ok(Math.abs(content.parent!.rotation.y + rotation * Math.PI / 2) < 1e-8);
    assert.equal(model.children.filter(part => part.name === 'facility-access-paving').length, 1,
      'a small industrial lot needs a loading apron, not a perimeter highway');
    const roadModel = createTileModel(road, localState), apron = roadModel.getObjectByName('road-facility-apron');
    assert.ok(apron, 'the driveway must visibly cross the street sidewalk');
    const end = plan.points[plan.points.length - 1];
    assert.ok(Math.abs((dx ? apron.position.z : apron.position.x)
      - (dx ? end.z - (road.z - localState.size / 2 + .5) : end.x - (road.x - localState.size / 2 + .5))) < 1e-8,
    'the curb opening follows the actual lane offset');
    assert.equal(meshParts(roadModel, .075, .004, .12).length, 0, 'a factory entrance is not a road intersection');
    assert.equal(createTileModel(continuation, localState).getObjectByName('road-facility-apron'), undefined,
      'only the selected gate opens the curb');
  }
});

test('triangulated access surfaces support wheels between vertices without bridging curved ramps', () => {
  const cases = [
    { kind: 'police', rotation: 1, side: 'west', elevation: .5 },
    { kind: 'fire', rotation: 3, side: 'east', elevation: .5 },
    { kind: 'hospital', rotation: 2, side: 'north', elevation: .2 },
    { kind: 'airport', rotation: 0, side: 'south', elevation: 0 },
  ] as const;
  for (const { kind, rotation, side, elevation } of cases) {
    const localState = createCity(917, true, 40), x = 15, z = 15;
    for (const cell of localState.tiles) Object.assign(cell, { kind: 'empty', level: 0, elevation: 0, anchor: -1 });
    const [width, depth] = getModelFootprint(kind, rotation), anchor = z * localState.size + x;
    for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) {
      Object.assign(localState.tiles[(z + dz) * localState.size + x + dx], { kind, level: 1, rotation, anchor, elevation });
    }
    if (side === 'north' || side === 'south') {
      const roadZ = side === 'north' ? z - 1 : z + depth;
      for (let roadX = x - 2; roadX < x + width + 2; roadX++) localState.tiles[roadZ * localState.size + roadX].kind = 'road';
    } else {
      const roadX = side === 'west' ? x - 1 : x + width;
      for (let roadZ = z - 2; roadZ < z + depth + 2; roadZ++) localState.tiles[roadZ * localState.size + roadX].kind = 'road';
    }
    const rootTile = localState.tiles[anchor], plan = getFacilityAccess(localState, rootTile)!;
    assert.ok(plan.connected);
    const model = createTileModel(rootTile, localState);
    model.position.set(x - localState.size / 2 + .5, elevation, z - localState.size / 2 + .5);
    model.updateMatrixWorld(true);
    const surfaces: THREE.Mesh[] = [];
    model.traverse(part => { if (part instanceof THREE.Mesh && part.userData.drivingSurface) surfaces.push(part); });
    if (kind === 'airport') {
      const triangles = surfaces.reduce((total, mesh) => total + mesh.geometry.index!.count / 3, 0);
      assert.ok(triangles < 20_000, `a flat airport should retain coarse pavement, got ${triangles} triangles`);
    }
    const ray = new THREE.Raycaster();
    ray.ray.direction.set(0, -1, 0);
    for (let i = 0; i + 1 < plan.points.length; i += 3) {
      const a = plan.points[i], b = plan.points[i + 1], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (!length) continue;
      for (const offset of [-.11, 0, .11]) {
        const wx = a.x + dx * .37 - dz / length * offset, wz = a.z + dz * .37 + dx / length * offset;
        const expected = sampleFacilityAccessHeight(plan, wx, wz);
        if (expected === null) continue;
        ray.ray.origin.set(wx, 20, wz);
        const hit = ray.intersectObjects(surfaces, false)[0];
        assert.ok(hit, `${kind} needs real visible pavement beneath its wheel tracks`);
        assert.ok(Math.abs(hit.point.y - expected) <= .004,
          `${kind} ramp geometry and suspension disagree by ${Math.abs(hit.point.y - expected)} at ${wx},${wz}`);
      }
    }
  }
});

function allModelMaterials(object: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();
  object.traverse(child => {
    if (child instanceof THREE.Mesh) for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  return materials;
}

test('original opaque glazing remains non-emissive while discrete window lights stay subtle', () => {
  const buildings = new THREE.Group();
  for (const kind of ['residential', 'commercial'] as const) {
    for (const level of [1, 2, 3, 4]) buildings.add(createTileModel(tile(kind, { level }), state));
  }
  const materials = [...allModelMaterials(buildings)];
  const glass = materials.filter(material => material.userData.glazing);
  const lights = materials.filter(material => material.userData.buildingWindowLight);
  assert.ok(glass.length > 0, 'original buildings need their established glass surfaces');
  assert.ok(lights.length > 0, 'night lighting must use distinct small window lights');
  buildings.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const surfaceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    if (!surfaceMaterials.some(material => material.userData.buildingWindowLight)) return;
    const dimensions = boundsOf(child).getSize(new THREE.Vector3()).toArray().sort((a, b) => a - b);
    assert.ok(dimensions[0] <= .02 && dimensions[1] * dimensions[2] <= .025,
      'emissive panes must be small individual windows, not glowing facade bands');
  });
  try {
    let previousNightIntensity = -1;
    for (const blend of [0, .5, 1]) {
      setModelNightBlend(blend);
      for (const wet of [false, true]) {
        setModelWet(wet);
        for (const material of glass) {
          assert.ok(material instanceof THREE.MeshStandardMaterial);
          assert.equal(material instanceof THREE.MeshPhysicalMaterial, false, 'original glazing stays opaque');
          assert.equal(material.transparent, false);
          assert.equal(material.opacity, 1);
          assert.equal(material.emissiveIntensity, 0, 'a whole glass facade must not glow');
          assert.equal(material.emissive.getHex(), 0);
        }
        for (const material of lights) {
          assert.ok(material instanceof THREE.MeshStandardMaterial);
          assert.ok(material.emissiveIntensity >= 0 && material.emissiveIntensity <= .2,
            'individual window lights must remain below the bloom-prone intensity range');
          if (blend === 0) assert.equal(material.emissiveIntensity, 0);
          else assert.ok(material.emissiveIntensity > 0);
        }
      }
      const intensity = lights.reduce((sum, material) => sum + (material as THREE.MeshStandardMaterial).emissiveIntensity, 0);
      assert.ok(intensity > previousNightIntensity, 'window illumination should increase continuously toward night');
      previousNightIntensity = intensity;
    }
  } finally { setModelWet(false); setModelNightBlend(0); }
});

test('raytracing snapshots preserve original opaque glazing and low window emission', async () => {
  const source = new THREE.Scene();
  source.add(createTileModel(tile('commercial', { level: 3 }), state));
  setModelNightBlend(1);
  const snapshot = await createPathTracingSnapshot(source, true);
  try {
    const originalMaterials = [...allModelMaterials(source)];
    const originalGlass = originalMaterials.filter(material => material.userData.glazing);
    const originalLights = originalMaterials.filter(material => material.userData.buildingWindowLight);
    const snapshotMaterials = [...allModelMaterials(snapshot.scene)];
    const snapshotGlass = snapshotMaterials.filter(material => material.userData.glazing);
    const snapshotLights = snapshotMaterials.filter(material => material.userData.buildingWindowLight);
    assert.ok(originalGlass.length > 0 && originalLights.length > 0);
    assert.equal(snapshotGlass.length, originalGlass.length);
    assert.equal(snapshotLights.length, originalLights.length);
    for (const material of [...snapshotGlass, ...snapshotLights]) {
      assert.ok(material instanceof THREE.MeshStandardMaterial);
      assert.equal(material instanceof THREE.MeshPhysicalMaterial, false);
      assert.ok(!originalMaterials.includes(material), 'snapshot materials must remain independently owned');
      assert.equal(material.transparent, false);
      assert.equal(material.opacity, 1);
      if (material.userData.glazing) assert.equal(material.emissiveIntensity, 0);
      else assert.ok(material.emissiveIntensity > 0 && material.emissiveIntensity <= .2);
    }
    setModelNightBlend(0);
    for (const material of snapshotLights) {
      assert.ok((material as THREE.MeshStandardMaterial).emissiveIntensity > 0,
        'a live day/night change must not change a captured raytracing frame');
    }
  } finally { snapshot.dispose(); setModelNightBlend(0); }
});
