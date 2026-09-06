import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFireEffects, fireIntensity, getFirePatches, MAX_FIRE_SITES } from '../src/fire-effects.ts';
import { createCity } from '../src/simulation.ts';
import { createTileModel, getModelFootprint } from '../src/models.ts';
import type { CityState, Tile, TileKind } from '../src/types.ts';

function city(size = 40): CityState {
  const state = createCity(1278, true, size);
  for (const tile of state.tiles) Object.assign(tile, { kind: 'empty', fire: 0, anchor: -1, elevation: 0, level: 0 });
  return state;
}
function burn(state: CityState, x: number, z: number, kind: TileKind = 'residential', level = 1, fire = 6): Tile {
  const tile = state.tiles[z*state.size+x]; Object.assign(tile, { kind, level, fire }); return tile;
}
function batch(effects: ReturnType<typeof createFireEffects>, name: string): THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  const object = effects.group.getObjectByName(`fire-${name}`);
  assert.ok(object instanceof THREE.Mesh && object.geometry instanceof THREE.InstancedBufferGeometry && object.material instanceof THREE.ShaderMaterial);
  return object as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
}

test('burn intensity distinguishes every remaining fire stage and clamps malformed data safely', () => {
  assert.equal(fireIntensity(0), 0); assert.equal(fireIntensity(-1), 0);
  assert.equal(fireIntensity(NaN), 0); assert.equal(fireIntensity(Infinity), 0);
  for (let fire = 1; fire < 6; fire++) assert.ok(fireIntensity(fire) < fireIntensity(fire+1));
  assert.equal(fireIntensity(6), 1); assert.equal(fireIntensity(1000), 1);
});

test('pre-existing fires produce animated flames, smoke and embers without changing saved city state', t => {
  const state = city(); burn(state, 4, 7); burn(state, 5, 7, 'commercial', 3, 2);
  const before = JSON.stringify(state), effects = createFireEffects(state); t.after(() => effects.dispose());
  const debug = effects.getDebug();
  assert.equal(debug.burningBuildings, 2); assert.equal(debug.visibleBuildings, 2);
  assert.equal(debug.flames, 12); assert.equal(debug.smoke, 12); assert.equal(debug.embers, 16);
  assert.equal(debug.drawCalls, 3);
  assert.ok(debug.sites[0].intensity > debug.sites[1].intensity);
  effects.animate(7, { x: 0, z: 0 });
  assert.equal(batch(effects, 'flames').material.uniforms.uTime.value, 7);
  assert.equal(batch(effects, 'smoke').material.uniforms.uTime.value, 7);
  assert.equal(batch(effects, 'embers').material.uniforms.uTime.value, 7);
  assert.equal(JSON.stringify(state), before, 'Visual fire may never change fire duration, money or progression');
});

test('static building models keep identical geometry while burning, with no baked flame primitives', () => {
  const state = city(), tile = burn(state, 4, 5, 'residential', 1);
  const burning = createTileModel(tile, state), normal = createTileModel({ ...tile, fire: 0 }, state);
  const snapshot = (model: THREE.Group) => {
    const meshes: { geometry: number; position: number[]; scale: number[] }[] = [];
    model.traverse(object => {
      if (object instanceof THREE.Mesh) meshes.push({ geometry: object.geometry.id, position: object.position.toArray(), scale: object.scale.toArray() });
    });
    return meshes;
  };
  assert.deepEqual(snapshot(burning), snapshot(normal));
});

test('a burning 60-cell airport creates one set of roof effects and not sixty duplicated buildings', t => {
  const state = city(), root = burn(state, 8, 10, 'airport');
  root.anchor = root.z*state.size+root.x;
  for (let z = 10; z < 16; z++) for (let x = 8; x < 18; x++) Object.assign(burn(state, x, z, 'airport'), { anchor: root.anchor });
  const effects = createFireEffects(state); t.after(() => effects.dispose());
  assert.equal(effects.getDebug().burningBuildings, 1); assert.equal(effects.getDebug().flames, 6);
  const positions = batch(effects, 'flames').geometry.getAttribute('aOrigin');
  const half = state.size/2;
  // Terminal and hangar are away from the runway at the footprint centre.
  for (let i = 0; i < 6; i++) {
    const x = positions.getX(i)-(root.x-half+.5), z = positions.getZ(i)-(root.z-half+.5);
    assert.ok(z > 2.5 || x > 7, 'Flames must sit on terminal/hangar roofs, not the central runway');
    assert.ok(positions.getY(i) > .8 && positions.getY(i) < 1.0);
  }
});

test('roof profiles follow rotations, terrain and high-rise roofs rather than antennas or tile midpoint', t => {
  const state = city();
  const tall = burn(state, 6, 8, 'commercial', 3), station = burn(state, 12, 13, 'fire');
  tall.variation = 4; tall.elevation = 1.5;
  station.rotation = 1; station.anchor = station.z*state.size+station.x;
  const plain = getFirePatches({ ...station, rotation: 0 })[0], rotated = getFirePatches(station)[0];
  // Exact frame mapping uses centred source coordinates, before its footprint offset.
  const local = { x: -.20, z: -.25 };
  assert.ok(Math.abs(rotated.x-(-local.z+.5)) < 1e-9);
  assert.ok(Math.abs(rotated.z-(local.x+1)) < 1e-9);
  assert.equal(rotated.width, plain.depth); assert.equal(rotated.depth, plain.width);
  const effects = createFireEffects(state); t.after(() => effects.dispose());
  const positions = batch(effects, 'flames').geometry.getAttribute('aOrigin');
  assert.ok(positions.getY(0) > 5.4 && positions.getY(0) < 5.6, 'Main tower fire belongs at the actual elevated roof');
  assert.ok(positions.getY(1) < positions.getY(0)-1, 'The lower tower has its own roof fire');
});

test('every facility roof patch fits its corresponding visible model in all four orientations', () => {
  const state = city();
  const kinds: TileKind[] = ['power','waterpump','police','fire','hospital','school','university','stadium','airport','seaport','wind','solar','recycling'];
  for (const kind of kinds) for (const rotation of [0,1,2,3] as const) {
    const tile = { ...state.tiles[0], kind, level: 1, fire: 0, rotation };
    const model = createTileModel(tile, state), bounds = new THREE.Box3().setFromObject(model);
    const [width, depth] = getModelFootprint(kind, rotation);
    for (const roof of getFirePatches(tile)) {
      assert.ok(roof.x >= -.5 && roof.x <= width-.5, `${kind}:${rotation}: x inside plot`);
      assert.ok(roof.z >= -.5 && roof.z <= depth-.5, `${kind}:${rotation}: z inside plot`);
      assert.ok(roof.y > .1 && roof.y <= bounds.max.y+.02, `${kind}:${rotation}: below model top`);
      assert.ok(roof.x >= bounds.min.x && roof.x <= bounds.max.x && roof.z >= bounds.min.z && roof.z <= bounds.max.z, `${kind}:${rotation}: inside model bounds`);
    }
    // Models share primitive geometry and material caches; don't dispose them.
  }
});

test('a 128 by 128 conflagration keeps a fixed particle budget and prioritizes the nearby camera', t => {
  const state = city(128);
  for (const tile of state.tiles) Object.assign(tile, { kind: 'residential', level: 1, fire: 6 });
  const effects = createFireEffects(state); t.after(() => effects.dispose());
  assert.equal(effects.getDebug().burningBuildings, 128*128);
  assert.equal(effects.getDebug().visibleBuildings, MAX_FIRE_SITES);
  assert.equal(effects.getDebug().flames, MAX_FIRE_SITES*6);
  assert.equal(effects.getDebug().drawCalls, 3);
  effects.animate(2, { x: 57, z: 55 });
  for (const site of effects.getDebug().sites) assert.ok((site.x-57)**2+(site.z-55)**2 < 115);
  const origins = batch(effects, 'flames').geometry.getAttribute('aOrigin');
  assert.ok(origins instanceof THREE.InstancedBufferAttribute);
  const version = origins.version;
  effects.animate(2.016, { x: 57, z: 55 }); effects.animate(2.032, { x: 57.1, z: 55 });
  assert.equal(batch(effects, 'flames').geometry.getAttribute('aOrigin'), origins);
  assert.equal(origins.version, version, 'Routine animation stays on the GPU; no particle buffer uploads per frame');
});

test('extinguishing hides all effects immediately and a later burn reuses the same resources', t => {
  const state = city(), tile = burn(state, 3, 7), effects = createFireEffects(state); t.after(() => effects.dispose());
  const geometry = batch(effects, 'flames').geometry;
  tile.fire = 0; effects.update(state);
  assert.equal(effects.group.visible, false); assert.equal(effects.getDebug().drawCalls, 0);
  assert.equal(effects.getDebug().flames, 0); assert.equal(effects.getDebug().smoke, 0); assert.equal(effects.getDebug().embers, 0);
  tile.fire = 1; effects.update(state);
  assert.equal(effects.group.visible, true); assert.equal(effects.getDebug().burningBuildings, 1);
  assert.equal(batch(effects, 'flames').geometry, geometry);
});

test('disposal releases exactly owned resources, detaches the group and makes late calls harmless', () => {
  const state = city(); burn(state, 2, 7);
  const effects = createFireEffects(state), scene = new THREE.Scene(); scene.add(effects.group);
  let geometryDisposals = 0, materialDisposals = 0;
  for (const name of ['flames','smoke','embers']) {
    const item = batch(effects, name);
    item.geometry.addEventListener('dispose', () => geometryDisposals++);
    item.material.addEventListener('dispose', () => materialDisposals++);
    assert.equal(item.material.depthWrite, false); assert.equal(item.material.depthTest, true);
    assert.equal(item.castShadow, false);
  }
  effects.dispose(); effects.dispose(); effects.update(state); effects.animate(9, { x: 0, z: 0 });
  assert.equal(geometryDisposals, 3); assert.equal(materialDisposals, 3);
  assert.equal(scene.children.length, 0); assert.equal(effects.group.children.length, 0);
  assert.equal(effects.getDebug().visibleBuildings, 0); assert.equal(effects.getDebug().drawCalls, 0);
});

function connectedRoofFixture(kind: TileKind, rotation: Tile['rotation'], side: 'north' | 'east' | 'south' | 'west') {
  const state = city(), tile = burn(state, 12, 12, kind, kind === 'industrial' ? 2 : 1);
  tile.rotation = rotation;
  const [width, depth] = getModelFootprint(kind, rotation);
  if (kind !== 'industrial') {
    tile.anchor = tile.z*state.size+tile.x;
    for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) {
      Object.assign(state.tiles[(tile.z+dz)*state.size+tile.x+dx], tile, { x: tile.x+dx, z: tile.z+dz });
    }
  }
  const x = side === 'west' ? tile.x-1 : side === 'east' ? tile.x+width : tile.x+Math.floor(width/2);
  const z = side === 'north' ? tile.z-1 : side === 'south' ? tile.z+depth : tile.z+Math.floor(depth/2);
  const road = state.tiles[z*state.size+x]; road.kind = 'road';
  return { state, tile, road };
}

function assertRoofsFollowActualContent(state: CityState, tile: Tile) {
  const model = createTileModel(tile, state), content = model.getObjectByName('facility-content');
  assert.ok(content, `${tile.kind} must render connected inset content`);
  model.updateMatrixWorld(true);
  const [baseWidth, baseDepth] = getModelFootprint(tile.kind, 0);
  const unconnected = getFirePatches({ ...tile, rotation: 0 });
  const actual = getFirePatches(tile, state);
  assert.equal(actual.length, unconnected.length);
  for (let i = 0; i < actual.length; i++) {
    const local = unconnected[i], roof = actual[i];
    const center = new THREE.Vector3(local.x-(baseWidth-1)/2, local.y, local.z-(baseDepth-1)/2);
    const expected = center.clone().applyMatrix4(content.matrixWorld);
    const corners = new THREE.Box3();
    for (const sx of [-1,1]) for (const sz of [-1,1]) {
      corners.expandByPoint(center.clone().add(new THREE.Vector3(sx*local.width/2, 0, sz*local.depth/2)).applyMatrix4(content.matrixWorld));
    }
    const label = `${tile.kind}:${tile.rotation}: roof ${i}`;
    assert.ok(Math.abs(roof.x-expected.x) < 1e-9 && Math.abs(roof.z-expected.z) < 1e-9, `${label} centre must follow actual model matrix`);
    assert.ok(Math.abs(roof.y-expected.y) < 1e-9, `${label} fire must follow raised/lowered content`);
    assert.ok(Math.abs(roof.width-(corners.max.x-corners.min.x)) < 1e-9, `${label} width must fit inset roof`);
    assert.ok(Math.abs(roof.depth-(corners.max.z-corners.min.z)) < 1e-9, `${label} depth must fit inset roof`);
  }
}

test('connected civic fires follow actual inset roof geometry in every saved orientation', () => {
  const kinds: TileKind[] = ['power','waterpump','police','fire','hospital','school','university','stadium','airport','seaport','wind','solar','recycling'];
  for (const kind of kinds) for (const rotation of [0,1,2,3] as const) {
    const { state, tile } = connectedRoofFixture(kind, rotation, 'north');
    assertRoofsFollowActualContent(state, tile);
  }
});

test('factory fire follows its loading apron shift and road-facing orientation on every side', () => {
  for (const side of ['north','east','south','west'] as const) {
    const { state, tile } = connectedRoofFixture('industrial', 0, side);
    const savedRotation = tile.rotation;
    assertRoofsFollowActualContent(state, tile);
    assert.equal(tile.rotation, savedRotation, 'Effects must not persist the derived factory orientation');
  }
});

test('active particles return to original factory roofs when the access road is removed', t => {
  const { state, tile, road } = connectedRoofFixture('industrial', 0, 'east');
  const effects = createFireEffects(state); t.after(() => effects.dispose());
  const origins = batch(effects, 'flames').geometry.getAttribute('aOrigin');
  const connectedPosition = [origins.getX(0), origins.getY(0), origins.getZ(0)];
  const connectedRoof = getFirePatches(tile, state)[0];
  const half = state.size/2;
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(origins.getX(i)-(tile.x-half+.5+connectedRoof.x)) <= connectedRoof.width*.4);
    assert.ok(Math.abs(origins.getZ(i)-(tile.z-half+.5+connectedRoof.z)) <= connectedRoof.depth*.4);
    assert.ok(Math.abs(origins.getY(i)-(connectedRoof.y-.025)) < 1e-6);
  }
  road.kind = 'empty'; effects.update(state);
  assert.deepEqual(getFirePatches(tile, state), getFirePatches(tile));
  assert.notDeepEqual([origins.getX(0), origins.getY(0), origins.getZ(0)], connectedPosition);
  assert.equal(effects.getDebug().burningBuildings, 1); assert.equal(effects.getDebug().drawCalls, 3);
});
