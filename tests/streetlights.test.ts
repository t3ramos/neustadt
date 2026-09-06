import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../src/simulation.ts';
import { createTileModel } from '../src/models.ts';
import { sampleRoadHeight } from '../src/road-graphics.ts';
import { createStreetlights, getRoadStreetlightFixture, removeLegacyStreetlight } from '../src/streetlights.ts';
import type { CityState, Tile } from '../src/types.ts';

function city(): CityState {
  const state = createCity(6743, true, 40);
  for (const tile of state.tiles) { tile.kind = 'empty'; tile.elevation = 0; tile.powered = false; tile.fire = 0; }
  return state;
}
function road(state: CityState, x: number, z: number, elevation = 0, powered = true): Tile {
  const tile = state.tiles[z * state.size + x];
  Object.assign(tile, { kind: 'road', elevation, powered });
  return tile;
}
function mesh(helper: ReturnType<typeof createStreetlights>, name: string): THREE.InstancedMesh {
  const object = helper.group.getObjectByName(`streetlight-${name}`);
  assert.ok(object instanceof THREE.InstancedMesh);
  return object;
}
function pointLights(helper: ReturnType<typeof createStreetlights>): THREE.PointLight[] {
  return helper.group.children.filter((object): object is THREE.PointLight => object instanceof THREE.PointLight);
}
function material(batch: THREE.InstancedMesh): THREE.MeshStandardMaterial {
  assert.ok(batch.material instanceof THREE.MeshStandardMaterial);
  return batch.material;
}
function instancePosition(batch: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4(); batch.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}
function denseRoads(state: CityState): void {
  for (let z = 3; z < 35; z += 4) for (let x = 2; x < 38; x++) road(state, x, z);
}

test('legacy replacement removes only the three exact road-lamp children without disposing shared primitives', () => {
  const state = city(), tile = road(state, 10, 8), model = createTileModel(tile, state);
  const before = [...model.children], originals = before.slice(-3) as THREE.Mesh[];
  let disposalCount = 0;
  for (const item of originals) {
    item.geometry.addEventListener('dispose', () => disposalCount++);
    (item.material as THREE.Material).addEventListener('dispose', () => disposalCount++);
  }
  const decoy = originals[2].clone(); decoy.scale.x *= 2; model.add(decoy);
  removeLegacyStreetlight(model, tile);
  assert.equal(model.children.length, before.length - 2);
  assert.ok(originals.every(item => !model.children.includes(item)));
  assert.ok(before.slice(0, -3).every(item => model.children.includes(item)));
  assert.ok(model.children.includes(decoy), 'An unrelated detail sharing position must survive');
  assert.equal(disposalCount, 0, 'Removed road details share geometry and materials with other models');
  removeLegacyStreetlight(model, tile);
  assert.equal(model.children.length, before.length - 2, 'Removal is idempotent');
  const nonRoad = createTileModel(tile, state);
  removeLegacyStreetlight(nonRoad, { ...tile, kind: 'rail' });
  assert.equal(nonRoad.children.length, before.length);
});

test('fixtures follow the existing road lattice while only powered, non-burning roads produce illumination', t => {
  const state = city();
  road(state, 10, 8); road(state, 16, 8, 0, false);
  road(state, 22, 8).fire = 3;
  road(state, 11, 8);
  const rail = road(state, 28, 8); rail.kind = 'rail';
  const helper = createStreetlights(state); t.after(() => helper.dispose());
  helper.setLighting(1, true);
  const { count, litCount, pointLights, activePointLights, ...diagnostics } = helper.getDebug();
  assert.deepEqual({ count, litCount, pointLights, activePointLights }, { count: 3, litCount: 1, pointLights: 0, activePointLights: 0 });
  assert.equal(diagnostics.groundPools, 1); assert.equal(diagnostics.enabled, true); assert.equal(diagnostics.nightBlend, 1);
  assert.equal(diagnostics.positions.length, 3); assert.equal(diagnostics.points.length, 0);
  const fixture = getRoadStreetlightFixture(state, state.tiles[8 * state.size + 10])!;
  assert.deepEqual(diagnostics.positions[0], { id: 8 * state.size + 10, x: fixture.bulb.x, y: fixture.bulb.y, z: fixture.bulb.z, powered: true });
  assert.equal(diagnostics.field.sources, 1);
  assert.equal(mesh(helper, 'bases').count, 3);
  assert.equal(mesh(helper, 'off-lenses').count, 2);
  assert.equal(mesh(helper, 'lit-lenses').count, 1);
  assert.equal(mesh(helper, 'ground-pools').count, 2);
});

test('day, night and switch-off keep every lamp in the field with strictly zero off emission', t => {
  const state = city(); denseRoads(state);
  const helper = createStreetlights(state); t.after(() => helper.dispose());
  const identities = pointLights(helper);
  assert.equal(identities.length, 0);
  helper.setLighting(0, true);
  assert.equal(helper.getDebug().activePointLights, 0);
  assert.equal(material(mesh(helper, 'ground-pools')).emissiveIntensity, 0);
  assert.equal(mesh(helper, 'ground-pools').visible, false);
  assert.ok(material(mesh(helper, 'lit-lenses')).emissiveIntensity > 0);
  helper.setLighting(1, true);
  assert.equal(helper.getDebug().field.sources, helper.getDebug().litCount);
  assert.equal(helper.getDebug().field.strength, 1);
  assert.ok(material(mesh(helper, 'lit-lenses')).emissiveIntensity > 3);
  assert.ok(material(mesh(helper, 'ground-pools')).opacity > .3);
  for (const light of identities) assert.ok(light.visible && !light.castShadow && light.distance <= 2 && light.decay === 2);
  helper.setLighting(1, false);
  assert.equal(helper.getDebug().litCount, 0);
  assert.equal(helper.getDebug().groundPools, 0); assert.equal(helper.getDebug().enabled, false);
  assert.equal(material(mesh(helper, 'lit-lenses')).emissiveIntensity, 0);
  assert.equal(material(mesh(helper, 'ground-pools')).emissiveIntensity, 0);
  assert.equal(material(mesh(helper, 'ground-pools')).opacity, 0);
  assert.ok(identities.every(light => light.intensity === 0 && light.visible));
  assert.ok(helper.group.visible);
  assert.deepEqual(pointLights(helper), identities);
  helper.setLighting(Number.NaN, true);
  assert.ok(Number.isFinite(material(mesh(helper, 'lit-lenses')).emissiveIntensity));
  assert.equal(helper.getDebug().activePointLights, 0);
});

test('camera movement and quality changes never reassign, disable or cap powered lamps', t => {
  const state=city();denseRoads(state);
  const helper=createStreetlights(state);t.after(()=>helper.dispose());helper.setLighting(1,true);
  const before=helper.getDebug();assert.ok(before.litCount>40);
  assert.equal(before.field.sources,before.litCount);assert.equal(before.groundPools,before.litCount);
  for(const quality of ['performance','balanced','ultra'] as const){
    helper.setQuality(quality);
    for(const target of [new THREE.Vector3(-15,0,-15),new THREE.Vector3(15,0,15),new THREE.Vector3(1000,0,1000)]){
      helper.animate(1,target);assert.deepEqual(helper.getDebug(),before);
    }
  }
});

test('power loss, fire and road removal refresh active light assignments without stale illumination', t => {
  const state = city(), first = road(state, 10, 8), second = road(state, 16, 8);
  const helper = createStreetlights(state); t.after(() => helper.dispose()); helper.setLighting(1, true);
  assert.equal(helper.getDebug().field.sources, 2);
  first.powered = false; helper.update(state);
  assert.equal(helper.getDebug().litCount, 1);
  assert.equal(helper.getDebug().field.sources, 1);
  second.fire = 1; helper.update(state);
  assert.equal(helper.getDebug().litCount, 0);
  assert.ok(pointLights(helper).every(light => light.intensity === 0));
  assert.equal(mesh(helper, 'ground-pools').visible, false);
  first.kind = second.kind = 'empty'; helper.update(state);
  assert.equal(helper.getDebug().count, 0);
  assert.equal(mesh(helper, 'poles').count, 0);
  assert.equal(mesh(helper, 'ground-pools').count, 0);
  assert.equal(pointLights(helper).length, 0);
});

test('fixture bases and every pool triangle conform to the actual nonplanar road surface', t => {
  const state = city();
  road(state, 10, 8, 2);
  road(state, 9, 8, .5); road(state, 11, 8, 3); road(state, 10, 7, 1); road(state, 10, 9, 3.5);
  road(state, 9, 7, .25); road(state, 11, 9, 4);
  const helper = createStreetlights(state); t.after(() => helper.dispose()); helper.setLighting(1, true);
  const footing = instancePosition(mesh(helper, 'bases'), 0);
  assert.ok(Math.abs(footing.y - sampleRoadHeight(state, footing.x, footing.z) - .039) < .00001);
  const bulb = instancePosition(mesh(helper, 'lit-lenses'), 0);
  assert.ok(Math.abs(bulb.y - sampleRoadHeight(state, bulb.x, bulb.z) - .49) < .00001);
  const pools = mesh(helper, 'ground-pools'), matrix = new THREE.Matrix4();
  const positions = pools.geometry.getAttribute('position');
  for (let instance = 0; instance < pools.count; instance++) {
    pools.getMatrixAt(instance, matrix);
    assert.ok(matrix.determinant() > 0);
    const corners = Array.from({ length: 3 }, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix));
    for (let u = 0; u <= 8; u++) for (let v = 0; v <= 8 - u; v++) {
      const point = corners[0].clone().multiplyScalar(1 - u / 8 - v / 8).addScaledVector(corners[1], u / 8).addScaledVector(corners[2], v / 8);
      assert.ok(Math.abs(point.y - sampleRoadHeight(state, point.x, point.z) - .0457) < .00001,
        'The entire footprint must follow the road triangle, including its interior');
    }
  }
  // Exercise actual Three raycasting, rather than only the input matrices.
  helper.group.updateMatrixWorld(true);
  const x = 10.5 - state.size / 2, z = 8.5 - state.size / 2;
  const hits = new THREE.Raycaster(new THREE.Vector3(x + .17, 20, z - .09), new THREE.Vector3(0, -1, 0)).intersectObject(pools);
  assert.ok(hits.length > 0);
  assert.ok(Math.abs(hits[0].point.y - sampleRoadHeight(state, x + .17, z - .09) - .0457) < .00001);
});

test('bridge lamps stay above the deck and neighboring terrain edits invalidate fixture heights', t => {
  const state = city();
  road(state, 10, 8, -3);
  const neighbor = road(state, 10, 9, -2);
  const helper = createStreetlights(state); t.after(() => helper.dispose());
  const initial = instancePosition(mesh(helper, 'lit-lenses'), 0);
  assert.ok(Math.abs(initial.y - .49) < .00001, 'Bridge lighting follows the deck, never the submerged seabed');
  neighbor.kind = 'rail'; neighbor.elevation = 3;
  helper.update(state);
  const updated = instancePosition(mesh(helper, 'lit-lenses'), 0);
  assert.ok(updated.y > initial.y + .5);
  assert.ok(Math.abs(updated.y - sampleRoadHeight(state, updated.x, updated.z) - .49) < .00001);
});

test('ground pools use a finite soft alpha texture, preserve scene depth and opt out of AO geometry', t => {
  const state = city(); road(state, 10, 8);
  const helper = createStreetlights(state); t.after(() => helper.dispose());
  const pools = mesh(helper, 'ground-pools'), shader = material(pools), texture = shader.alphaMap;
  assert.ok(texture instanceof THREE.DataTexture);
  assert.equal(texture.image.width, 64); assert.equal(texture.image.height, 64);
  const pixels = texture.image.data;
  assert.ok(pixels);
  assert.equal(pixels[1], 0);
  assert.ok(pixels[(32 * 64 + 32) * 4 + 1] > 250);
  assert.equal(shader.depthWrite, false); assert.equal(shader.depthTest, true);
  assert.equal(shader.blending, THREE.AdditiveBlending);
  assert.equal(pools.renderOrder, 1.5);
  assert.equal(pools.castShadow, false);
  assert.equal(pools.userData.ambientOcclusionExclude, true);
  assert.equal(pools.userData.raytracingExclude, true);
});

test('collision fixture API shares the real rendered mast position and includes unpowered poles', t => {
  const state = city(), tile = road(state, 10, 8, 2, false);
  const helper = createStreetlights(state); t.after(() => helper.dispose());
  const fixture = getRoadStreetlightFixture(state, tile);
  assert.ok(fixture);
  assert.equal(fixture.mast.x, tile.x - state.size / 2 + .5 - .47);
  assert.equal(fixture.mast.z, tile.z - state.size / 2 + .5 + .47);
  const base = instancePosition(mesh(helper, 'bases'), 0);
  assert.ok(Math.abs(base.x - fixture.mast.x) < .00001);
  assert.ok(Math.abs(base.z - fixture.mast.z) < .00001);
  assert.ok(Math.abs(base.y - .014 - fixture.base.y) < .00001);
  const pole = instancePosition(mesh(helper, 'poles'), 0);
  assert.ok(Math.abs(pole.y - .234 - fixture.mast.y) < .00001);
  assert.equal(fixture.mastRadius, .014); assert.equal(fixture.mastHeight, .468);
  assert.equal(fixture.baseRadius, .036); assert.equal(fixture.baseHeight, .028);
  assert.equal(mesh(helper, 'poles').userData.drivingObstacle, true);
  assert.equal(mesh(helper, 'ground-pools').userData.drivingObstacle, false);
  assert.equal(mesh(helper, 'lit-lenses').userData.drivingObstacle, false);
  assert.equal(getRoadStreetlightFixture(state, { ...tile, kind: 'rail' }), null);
  assert.equal(getRoadStreetlightFixture(state, { ...tile, x: tile.x + 1 }), null);
});

test('unchanged updates reuse buffers and resized/disposed helpers release owned resources once', () => {
  const state = city(); road(state, 10, 8);
  const helper = createStreetlights(state), parent = new THREE.Scene(); parent.add(helper.group);
  const initialBatch = mesh(helper, 'poles'), initialMaterial = initialBatch.material;
  const version = initialBatch.instanceMatrix.version;
  let initialBatchDisposals = 0;
  initialBatch.addEventListener('dispose', () => initialBatchDisposals++);
  const geometrySet = new Set<THREE.BufferGeometry>(), materialSet = new Set<THREE.Material>();
  for (const child of helper.group.children) if (child instanceof THREE.Mesh) {
    geometrySet.add(child.geometry);
    for (const item of Array.isArray(child.material) ? child.material : [child.material]) materialSet.add(item);
  }
  const disposals = new Map<object, number>();
  const texture = material(mesh(helper, 'ground-pools')).alphaMap!;
  for (const resource of [...geometrySet, ...materialSet, texture]) resource.addEventListener('dispose', () => disposals.set(resource, (disposals.get(resource) ?? 0) + 1));
  helper.update(state);
  assert.equal(mesh(helper, 'poles'), initialBatch);
  assert.equal(initialBatch.instanceMatrix.version, version);
  denseRoads(state); helper.update(state);
  assert.notEqual(mesh(helper, 'poles'), initialBatch, 'Capacity grows when needed');
  assert.equal(initialBatchDisposals, 1);
  assert.equal(mesh(helper, 'poles').material, initialMaterial, 'Resizing must reuse materials');
  assert.equal(disposals.size, 0, 'Shared helper geometry/materials remain alive through instance resize');
  helper.dispose(); helper.dispose(); helper.update(state);
  assert.equal(helper.group.children.length, 0); assert.equal(parent.children.length, 0);
  assert.equal(disposals.size, geometrySet.size + materialSet.size + 1);
  assert.ok([...disposals.values()].every(count => count === 1));
});
