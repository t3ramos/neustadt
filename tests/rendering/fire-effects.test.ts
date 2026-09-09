import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  preloadEasterEggBuilding,
  disposeEasterEggBuildingAssets,
} from '../../src/rendering/buildings/easter-egg.ts';
import * as THREE from 'three';
import {
  createFireEffects,
  fireIntensity,
  getFirePatches,
  firePatchHeight,
  MAX_FIRE_SITES,
} from '../../src/rendering/effects/fire.ts';
import { createCity } from '../../src/simulation/city-simulation.ts';
import { createTileModel, getModelFootprint } from '../../src/rendering/buildings/models.ts';
import type { CityState, Tile, TileKind } from '../../src/domain/types.ts';

function city(size = 40): CityState {
  const state = createCity(1278, true, size);
  for (const tile of state.tiles)
    Object.assign(tile, { kind: 'empty', fire: 0, anchor: -1, elevation: 0, level: 0 });
  return state;
}
function burn(
  state: CityState,
  x: number,
  z: number,
  kind: TileKind = 'residential',
  level = 1,
  fire = 6,
): Tile {
  const tile = state.tiles[z * state.size + x];
  Object.assign(tile, { kind, level, fire });
  return tile;
}
function batch(
  effects: ReturnType<typeof createFireEffects>,
  name: string,
): THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  const object = effects.group.getObjectByName(`fire-${name}`);
  assert.ok(
    object instanceof THREE.Mesh &&
      object.geometry instanceof THREE.InstancedBufferGeometry &&
      object.material instanceof THREE.ShaderMaterial,
  );
  return object as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
}

test('burn intensity distinguishes every remaining fire stage and clamps malformed data safely', () => {
  assert.equal(fireIntensity(0), 0);
  assert.equal(fireIntensity(-1), 0);
  assert.equal(fireIntensity(NaN), 0);
  assert.equal(fireIntensity(Infinity), 0);
  for (let fire = 1; fire < 6; fire++) assert.ok(fireIntensity(fire) < fireIntensity(fire + 1));
  assert.equal(fireIntensity(6), 1);
  assert.equal(fireIntensity(1000), 1);
});

test('pre-existing fires produce animated flames, smoke and embers without changing saved city state', (t) => {
  const state = city();
  burn(state, 4, 7);
  burn(state, 5, 7, 'commercial', 3, 2);
  const before = JSON.stringify(state),
    effects = createFireEffects(state);
  t.after(() => effects.dispose());
  const debug = effects.getDebug();
  assert.equal(debug.burningBuildings, 2);
  assert.equal(debug.visibleBuildings, 2);
  assert.equal(debug.flames, 12);
  assert.equal(debug.smoke, 12);
  assert.equal(debug.embers, 16);
  assert.equal(debug.drawCalls, 3);
  assert.ok(debug.sites[0].intensity > debug.sites[1].intensity);
  effects.animate(7, { x: 0, z: 0 });
  assert.equal(batch(effects, 'flames').material.uniforms.uTime.value, 7);
  assert.equal(batch(effects, 'smoke').material.uniforms.uTime.value, 7);
  assert.equal(batch(effects, 'embers').material.uniforms.uTime.value, 7);
  assert.equal(
    JSON.stringify(state),
    before,
    'Visual fire may never change fire duration, money or progression',
  );
});

test('static building models keep identical geometry while burning, with no baked flame primitives', () => {
  const state = city(),
    tile = burn(state, 4, 5, 'residential', 1);
  const burning = createTileModel(tile, state),
    normal = createTileModel({ ...tile, fire: 0 }, state);
  const snapshot = (model: THREE.Group) => {
    const meshes: { geometry: number; position: number[]; scale: number[] }[] = [];
    model.traverse((object) => {
      if (object instanceof THREE.Mesh)
        meshes.push({
          geometry: object.geometry.id,
          position: object.position.toArray(),
          scale: object.scale.toArray(),
        });
    });
    return meshes;
  };
  assert.deepEqual(snapshot(burning), snapshot(normal));
});

test('a burning 60-cell airport creates one set of roof effects and not sixty duplicated buildings', (t) => {
  const state = city(),
    root = burn(state, 8, 10, 'airport');
  root.anchor = root.z * state.size + root.x;
  for (let z = 10; z < 16; z++)
    for (let x = 8; x < 18; x++)
      Object.assign(burn(state, x, z, 'airport'), { anchor: root.anchor });
  const effects = createFireEffects(state);
  t.after(() => effects.dispose());
  assert.equal(effects.getDebug().burningBuildings, 1);
  assert.equal(effects.getDebug().flames, 6);
  const positions = batch(effects, 'flames').geometry.getAttribute('aOrigin');
  const half = state.size / 2;
  // Terminal and hangar are away from the runway at the footprint centre.
  for (let i = 0; i < 6; i++) {
    const x = positions.getX(i) - (root.x - half + 0.5),
      z = positions.getZ(i) - (root.z - half + 0.5);
    assert.ok(z > 2.5 || x > 7, 'Flames must sit on terminal/hangar roofs, not the central runway');
    assert.ok(positions.getY(i) > 0.8 && positions.getY(i) < 1.0);
  }
});

test('roof profiles follow rotations, terrain and high-rise roofs rather than antennas or tile midpoint', (t) => {
  const state = city();
  const tall = burn(state, 6, 8, 'commercial', 3),
    station = burn(state, 12, 13, 'fire');
  tall.variation = 10;
  tall.elevation = 1.5;
  station.rotation = 1;
  station.anchor = station.z * state.size + station.x;
  const plain = getFirePatches({ ...station, rotation: 0 })[0],
    rotated = getFirePatches(station)[0];
  // Exact frame mapping uses centred source coordinates, before its footprint offset.
  const local = { x: -0.2, z: -0.25 };
  assert.ok(Math.abs(rotated.x - (-local.z + 0.5)) < 1e-9);
  assert.ok(Math.abs(rotated.z - (local.x + 1)) < 1e-9);
  assert.equal(rotated.width, plain.depth);
  assert.equal(rotated.depth, plain.width);
  const effects = createFireEffects(state);
  t.after(() => effects.dispose());
  const positions = batch(effects, 'flames').geometry.getAttribute('aOrigin');
  const actualModel = createTileModel(tall, state);
  actualModel.position.set(
    tall.x - state.size / 2 + 0.5,
    tall.elevation,
    tall.z - state.size / 2 + 0.5,
  );
  actualModel.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(),
    heights: number[] = [];
  for (let i = 0; i < 6; i++) {
    ray.set(
      new THREE.Vector3(positions.getX(i), 20, positions.getZ(i)),
      new THREE.Vector3(0, -1, 0),
    );
    const hit = ray.intersectObject(actualModel, true)[0];
    assert.ok(hit, 'A flame must have visible geometry directly beneath it');
    assert.ok(
      Math.abs(positions.getY(i) + 0.025 - hit.point.y) < 1e-5,
      'Flame base follows actual elevated cap, never antenna or obsolete tower dimensions',
    );
    heights.push(hit.point.y);
  }
  assert.ok(
    Math.max(...heights) - Math.min(...heights) > 0.8,
    'Both occupied tower levels receive fire',
  );
});

test('every facility roof patch fits its corresponding visible model in all four orientations', () => {
  const state = city();
  const kinds: TileKind[] = [
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
  for (const kind of kinds)
    for (const rotation of [0, 1, 2, 3] as const) {
      const tile = { ...state.tiles[0], kind, level: 1, fire: 0, rotation };
      const model = createTileModel(tile, state),
        bounds = new THREE.Box3().setFromObject(model);
      const [width, depth] = getModelFootprint(kind, rotation);
      for (const roof of getFirePatches(tile)) {
        assert.ok(roof.x >= -0.5 && roof.x <= width - 0.5, `${kind}:${rotation}: x inside plot`);
        assert.ok(roof.z >= -0.5 && roof.z <= depth - 0.5, `${kind}:${rotation}: z inside plot`);
        assert.ok(
          roof.y > 0.1 && roof.y <= bounds.max.y + 0.02,
          `${kind}:${rotation}: below model top`,
        );
        assert.ok(
          roof.x >= bounds.min.x &&
            roof.x <= bounds.max.x &&
            roof.z >= bounds.min.z &&
            roof.z <= bounds.max.z,
          `${kind}:${rotation}: inside model bounds`,
        );
      }
      // Models share primitive geometry and material caches; don't dispose them.
    }
});

test('a 128 by 128 conflagration keeps a fixed particle budget and prioritizes the nearby camera', (t) => {
  const state = city(128);
  for (const tile of state.tiles) Object.assign(tile, { kind: 'residential', level: 1, fire: 6 });
  const effects = createFireEffects(state);
  t.after(() => effects.dispose());
  assert.equal(effects.getDebug().burningBuildings, 128 * 128);
  assert.equal(effects.getDebug().visibleBuildings, MAX_FIRE_SITES);
  assert.equal(effects.getDebug().flames, MAX_FIRE_SITES * 6);
  assert.equal(effects.getDebug().drawCalls, 3);
  effects.animate(2, { x: 57, z: 55 });
  for (const site of effects.getDebug().sites)
    assert.ok((site.x - 57) ** 2 + (site.z - 55) ** 2 < 115);
  const origins = batch(effects, 'flames').geometry.getAttribute('aOrigin');
  assert.ok(origins instanceof THREE.InstancedBufferAttribute);
  const version = origins.version;
  effects.animate(2.016, { x: 57, z: 55 });
  effects.animate(2.032, { x: 57.1, z: 55 });
  assert.equal(batch(effects, 'flames').geometry.getAttribute('aOrigin'), origins);
  assert.equal(
    origins.version,
    version,
    'Routine animation stays on the GPU; no particle buffer uploads per frame',
  );
});

test('extinguishing hides all effects immediately and a later burn reuses the same resources', (t) => {
  const state = city(),
    tile = burn(state, 3, 7),
    effects = createFireEffects(state);
  t.after(() => effects.dispose());
  const geometry = batch(effects, 'flames').geometry;
  tile.fire = 0;
  effects.update(state);
  assert.equal(effects.group.visible, false);
  assert.equal(effects.getDebug().drawCalls, 0);
  assert.equal(effects.getDebug().flames, 0);
  assert.equal(effects.getDebug().smoke, 0);
  assert.equal(effects.getDebug().embers, 0);
  tile.fire = 1;
  effects.update(state);
  assert.equal(effects.group.visible, true);
  assert.equal(effects.getDebug().burningBuildings, 1);
  assert.equal(batch(effects, 'flames').geometry, geometry);
});

test('disposal releases exactly owned resources, detaches the group and makes late calls harmless', () => {
  const state = city();
  burn(state, 2, 7);
  const effects = createFireEffects(state),
    scene = new THREE.Scene();
  scene.add(effects.group);
  let geometryDisposals = 0,
    materialDisposals = 0;
  for (const name of ['flames', 'smoke', 'embers']) {
    const item = batch(effects, name);
    item.geometry.addEventListener('dispose', () => geometryDisposals++);
    item.material.addEventListener('dispose', () => materialDisposals++);
    assert.equal(item.material.depthWrite, false);
    assert.equal(item.material.depthTest, true);
    assert.equal(item.castShadow, false);
  }
  effects.dispose();
  effects.dispose();
  effects.update(state);
  effects.animate(9, { x: 0, z: 0 });
  assert.equal(geometryDisposals, 3);
  assert.equal(materialDisposals, 3);
  assert.equal(scene.children.length, 0);
  assert.equal(effects.group.children.length, 0);
  assert.equal(effects.getDebug().visibleBuildings, 0);
  assert.equal(effects.getDebug().drawCalls, 0);
});

function connectedRoofFixture(
  kind: TileKind,
  rotation: Tile['rotation'],
  side: 'north' | 'east' | 'south' | 'west',
) {
  const state = city(),
    tile = burn(state, 12, 12, kind, kind === 'industrial' ? 2 : 1);
  tile.rotation = rotation;
  tile.variation = 0;
  const [width, depth] = getModelFootprint(kind, rotation);
  if (kind !== 'industrial') {
    tile.anchor = tile.z * state.size + tile.x;
    for (let dz = 0; dz < depth; dz++)
      for (let dx = 0; dx < width; dx++) {
        Object.assign(state.tiles[(tile.z + dz) * state.size + tile.x + dx], tile, {
          x: tile.x + dx,
          z: tile.z + dz,
        });
      }
  }
  const x =
    side === 'west'
      ? tile.x - 1
      : side === 'east'
        ? tile.x + width
        : tile.x + Math.floor(width / 2);
  const z =
    side === 'north'
      ? tile.z - 1
      : side === 'south'
        ? tile.z + depth
        : tile.z + Math.floor(depth / 2);
  const road = state.tiles[z * state.size + x];
  road.kind = 'road';
  return { state, tile, road };
}

function assertRoofsFollowActualContent(state: CityState, tile: Tile) {
  const model = createTileModel(tile, state),
    content = model.getObjectByName('facility-content');
  assert.ok(content, `${tile.kind} must render connected inset content`);
  model.updateMatrixWorld(true);
  const [baseWidth, baseDepth] = getModelFootprint(tile.kind, 0);
  const unconnected = getFirePatches({ ...tile, rotation: 0 });
  const actual = getFirePatches(tile, state);
  assert.equal(actual.length, unconnected.length);
  for (let i = 0; i < actual.length; i++) {
    const local = unconnected[i],
      roof = actual[i];
    const center = new THREE.Vector3(
      local.x - (baseWidth - 1) / 2,
      local.y,
      local.z - (baseDepth - 1) / 2,
    );
    const expected = center.clone().applyMatrix4(content.matrixWorld);
    const corners = new THREE.Box3();
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        corners.expandByPoint(
          center
            .clone()
            .add(new THREE.Vector3((sx * local.width) / 2, 0, (sz * local.depth) / 2))
            .applyMatrix4(content.matrixWorld),
        );
      }
    const label = `${tile.kind}:${tile.rotation}: roof ${i}`;
    assert.ok(
      Math.abs(roof.x - expected.x) < 1e-9 && Math.abs(roof.z - expected.z) < 1e-9,
      `${label} centre must follow actual model matrix`,
    );
    assert.ok(
      Math.abs(roof.y - expected.y) < 1e-9,
      `${label} fire must follow raised/lowered content`,
    );
    assert.ok(
      Math.abs(roof.width - (corners.max.x - corners.min.x)) < 1e-9,
      `${label} width must fit inset roof`,
    );
    assert.ok(
      Math.abs(roof.depth - (corners.max.z - corners.min.z)) < 1e-9,
      `${label} depth must fit inset roof`,
    );
  }
}

test('connected civic fires follow actual inset roof geometry in every saved orientation', () => {
  const kinds: TileKind[] = [
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
  for (const kind of kinds)
    for (const rotation of [0, 1, 2, 3] as const) {
      const { state, tile } = connectedRoofFixture(kind, rotation, 'north');
      assertRoofsFollowActualContent(state, tile);
    }
});

test('factory fire follows its loading apron shift and road-facing orientation on every side', () => {
  for (const side of ['north', 'east', 'south', 'west'] as const) {
    const { state, tile } = connectedRoofFixture('industrial', 0, side);
    const savedRotation = tile.rotation;
    assertRoofsFollowActualContent(state, tile);
    assert.equal(
      tile.rotation,
      savedRotation,
      'Effects must not persist the derived factory orientation',
    );
  }
});

test('active particles return to original factory roofs when the access road is removed', (t) => {
  const { state, tile, road } = connectedRoofFixture('industrial', 0, 'east');
  const effects = createFireEffects(state);
  t.after(() => effects.dispose());
  const origins = batch(effects, 'flames').geometry.getAttribute('aOrigin');
  const connectedPosition = [origins.getX(0), origins.getY(0), origins.getZ(0)];
  const connectedRoof = getFirePatches(tile, state)[0];
  const half = state.size / 2;
  for (let i = 0; i < 6; i++) {
    assert.ok(
      Math.abs(origins.getX(i) - (tile.x - half + 0.5 + connectedRoof.x)) <=
        connectedRoof.width * 0.4,
    );
    assert.ok(
      Math.abs(origins.getZ(i) - (tile.z - half + 0.5 + connectedRoof.z)) <=
        connectedRoof.depth * 0.4,
    );
    assert.ok(Math.abs(origins.getY(i) - (connectedRoof.y - 0.025)) < 1e-6);
  }
  road.kind = 'empty';
  effects.update(state);
  assert.deepEqual(getFirePatches(tile, state), getFirePatches(tile));
  assert.notDeepEqual([origins.getX(0), origins.getY(0), origins.getZ(0)], connectedPosition);
  assert.equal(effects.getDebug().burningBuildings, 1);
  assert.equal(effects.getDebug().drawCalls, 3);
});

test('new RCI architectures emit fire on actual roof triangles for all lot sizes and saved rotations', () => {
  const state = city();
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 100);
  for (const kind of ['residential', 'commercial', 'industrial'] as const)
    for (const variation of [0, 1, 2, 3, 4])
      for (const [w, d] of [
        [1, 1],
        [2, 1],
        [2, 2],
        [3, 2],
        [2, 3],
      ])
        for (const rotation of [0, 1, 2, 3] as const)
          for (const level of kind === 'residential' ? [1, 2, 3, 4] : [2, 3, 4]) {
            if (variation === 0 && w === 1 && d === 1 && kind === 'industrial') continue;
            const tile = {
              ...state.tiles[12 * state.size + 12],
              kind,
              variation,
              level,
              rotation,
              lotWidth: w,
              lotDepth: d,
            };
            const model = createTileModel(tile, state);
            model.updateMatrixWorld(true);
            const roofs = getFirePatches(tile, state);
            assert.ok(roofs.length > 0, `${kind} v${variation} L${level} must have fire surfaces`);
            for (const roof of roofs)
              for (const ux of [-0.35, 0, 0.35])
                for (const uz of [-0.35, 0, 0.35]) {
                  const x = roof.x + roof.width * ux,
                    z = roof.z + roof.depth * uz,
                    y = firePatchHeight(roof, x, z);
                  ray.ray.origin.set(x, y + 20, z);
                  const hit = ray.intersectObject(model, true)[0];
                  assert.ok(
                    hit,
                    `${kind} v${variation} ${w}x${d} rot${rotation} (${x},${y},${z}) must touch roof geometry`,
                  );
                  assert.ok(
                    Math.abs(hit.point.y - y) < 0.003,
                    `${kind} v${variation} ${w}x${d} level ${level} rot${rotation} (${x},${z}): roof ${y} must match visible ${hit.point.y} on ${hit.object.name}`,
                  );
                }
          }
});

test('connected multi-cell industrial roof planes follow inset geometry and child cells emit no extra site', (t) => {
  const state = city(),
    tile = burn(state, 12, 12, 'industrial', 3);
  Object.assign(tile, {
    variation: 2,
    lotWidth: 3,
    lotDepth: 2,
    anchor: 12 * state.size + 12,
    rotation: 3,
  });
  for (let z = 12; z < 14; z++)
    for (let x = 12; x < 15; x++) Object.assign(state.tiles[z * state.size + x], tile, { x, z });
  state.tiles[14 * state.size + 13].kind = 'road';
  const model = createTileModel(tile, state);
  model.updateMatrixWorld(true);
  const roofs = getFirePatches(tile, state),
    ray = new THREE.Raycaster();
  for (const roof of roofs)
    for (const ux of [-0.3, 0.3]) {
      const x = roof.x + ux * roof.width,
        z = roof.z,
        y = firePatchHeight(roof, x, z);
      ray.set(new THREE.Vector3(x, y + 0.01, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(model, true)[0];
      assert.ok(hit && Math.abs(hit.point.y - y) < 0.003);
    }
  assert.deepEqual(getFirePatches(state.tiles[12 * state.size + 13], state), []);
  const effects = createFireEffects(state);
  t.after(() => effects.dispose());
  assert.equal(effects.getDebug().burningBuildings, 1);
  assert.equal(effects.getDebug().flames, 6);
  assert.equal(effects.getDebug().sites[0].x, tile.x - state.size / 2 + 1.5);
  assert.equal(effects.getDebug().sites[0].z, tile.z - state.size / 2 + 1);
});

test('Easter Egg fire follows the real GLB rear canopy in every parcel rotation', async (t) => {
  const bytes = await readFile(
    new URL('../../public/assets/models/easter-egg-office.glb', import.meta.url),
  );
  const loader = new GLTFLoader();
  // Geometry and node transforms come from the shipping GLB. Image pixels are
  // irrelevant to raycasts; avoid requiring a browser image decoder in Node.
  loader.register(() => ({
    name: 'test-texture-placeholder',
    loadTexture: async () => new THREE.Texture(),
  }));
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => gltf);
  await preloadEasterEggBuilding();
  t.after(() => disposeEasterEggBuildingAssets());
  const state = city();
  for (const rotation of [0, 1, 2, 3] as const) {
    const w = rotation % 2 ? 2 : 3,
      d = rotation % 2 ? 3 : 2;
    const tile = {
      ...state.tiles[0],
      kind: 'commercial' as const,
      variation: 900005,
      level: 4,
      rotation,
      lotWidth: w,
      lotDepth: d,
    };
    const roofs = getFirePatches(tile, state);
    const model = createTileModel(tile, state);
    assert.ok(model.getObjectByName('Easter Egg street-facing offices'));
    model.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (const roof of roofs) {
      for (const dx of [-0.5, 0, 0.5])
        for (const dz of [-0.5, 0, 0.5]) {
          ray.set(
            new THREE.Vector3(roof.x + dx * roof.width, 10, roof.z + dz * roof.depth),
            new THREE.Vector3(0, -1, 0),
          );
          const hit = ray.intersectObject(model, true)[0];
          assert.ok(hit, `Rotation ${rotation}: actual canopy geometry beneath every patch sample`);
          assert.ok(
            Math.abs(hit.point.y - roof.y) < 1e-6,
            'Fire must hit rear canopy, never furniture, solar cells or uncovered front roof',
          );
        }
      assert.ok(Math.abs(roof.y - 0.96081501245) < 1e-7);
      assert.ok(roof.x - roof.width / 2 >= -0.5 && roof.x + roof.width / 2 <= w - 0.5);
      assert.ok(roof.z - roof.depth / 2 >= -0.5 && roof.z + roof.depth / 2 <= d - 0.5);
    }
    const original = getFirePatches({ ...tile, rotation: 0, lotWidth: 3, lotDepth: 2 })[0];
    const expected = new THREE.Vector3(original.x - 1, 0, original.z - 0.5).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (-rotation * Math.PI) / 2,
    );
    assert.ok(Math.abs(roofs[0].x - (expected.x + (w - 1) / 2)) < 1e-9);
    assert.ok(Math.abs(roofs[0].z - (expected.z + (d - 1) / 2)) < 1e-9);
  }
});
