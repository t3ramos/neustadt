import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { airport, facilityArchitecture } from '../../src/rendering/buildings/facilities.ts';
import { facilityFrame } from '../../src/rendering/buildings/facility-frame.ts';
import {
  createFacilityActors,
  updateFacilityActors,
} from '../../src/rendering/buildings/facility-actors.ts';
import { createCity } from '../../src/simulation/city-simulation.ts';
import type { Tile } from '../../src/domain/types.ts';

const state = createCity(81, true, 40);
const bvhCache = new Map<THREE.BufferGeometry, MeshBVH>();
function meshes(group: THREE.Object3D) {
  group.updateMatrixWorld(true);
  const result: { mesh: THREE.Mesh; bounds: THREE.Box3; inverse: THREE.Matrix4; bvh: MeshBVH }[] =
    [];
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    let bvh = bvhCache.get(child.geometry);
    if (!bvh) {
      bvh = new MeshBVH(child.geometry);
      bvhCache.set(child.geometry, bvh);
    }
    result.push({
      mesh: child,
      bounds: new THREE.Box3().setFromObject(child),
      inverse: child.matrixWorld.clone().invert(),
      bvh,
    });
  });
  return result;
}
function tile(variation: number, rotation: number): Tile {
  return {
    ...state.tiles[12 * state.size + 12],
    x: 12,
    z: 12,
    kind: 'airport',
    variation,
    rotation: rotation as Tile['rotation'],
    anchor: -1,
    elevation: 0,
    level: 1,
  };
}

test('all airport variants leave the runway and taxiway clear of raised static geometry', () => {
  for (let v = 0; v < 5; v++) {
    const airportGroup = new THREE.Group();
    airport(airportGroup);
    facilityArchitecture(airportGroup, tile(v, 0));
    const staticMeshes = meshes(airportGroup);
    for (const [label, minZ, maxZ] of [
      ['runway', -2.165, -1.035],
      ['taxiway', -0.525, -0.095],
    ] as const) {
      const lane = new THREE.Box3(
        new THREE.Vector3(label === 'runway' ? -4.815 : -4.345, 0.18, minZ),
        new THREE.Vector3(label === 'runway' ? 4.815 : 4.345, 3, maxZ),
      );
      for (const item of staticMeshes) {
        if (!item.bounds.intersectsBox(lane)) continue;
        assert.equal(
          item.bvh.intersectsBox(lane, item.inverse),
          false,
          `${label} obstructed in variant ${v} by ${JSON.stringify(item.bounds)}`,
        );
      }
    }
    if (v) assert.ok(airportGroup.getObjectByName(`architecture-${v}`)?.children.length);
  }
});

test('actual aircraft meshes clear every airport variant and rotation throughout the closed flight cycle', () => {
  const relative = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0.713, 0.379, 0.59).normalize());
  for (let v = 0; v < 5; v++)
    for (let rotation = 0; rotation < 4; rotation++) {
      const airportTile = tile(v, rotation);
      const staticRoot = new THREE.Group();
      const frame = facilityFrame(staticRoot, airportTile);
      airport(frame);
      facilityArchitecture(frame, airportTile);
      const staticMeshes = meshes(staticRoot);
      const actors = createFacilityActors(airportTile, state)!;
      const plane = actors.getObjectByName('aircraft')!;
      const width = rotation % 2 ? 6 : 10,
        depth = rotation % 2 ? 10 : 6;
      for (let step = 0; step <= 1040; step++) {
        // Cancel actor seed so phase endpoints are tested identically for each variant.
        const elapsed = step * 0.05 - v;
        updateFacilityActors(actors, elapsed, state);
        actors.updateMatrixWorld(true);
        const flightBounds = new THREE.Box3().setFromObject(plane);
        assert.ok(
          flightBounds.min.x >= -0.5 - 1e-6 &&
            flightBounds.max.x <= width - 0.5 + 1e-6 &&
            flightBounds.min.z >= -0.5 - 1e-6 &&
            flightBounds.max.z <= depth - 0.5 + 1e-6,
          `flight outside footprint v${v} r${rotation} t${step * 0.05}: ${JSON.stringify(flightBounds)}`,
        );
        for (const moving of meshes(plane))
          for (const fixed of staticMeshes) {
            if (!moving.bounds.intersectsBox(fixed.bounds)) continue;
            relative.multiplyMatrices(fixed.inverse, moving.mesh.matrixWorld);
            const label = `collision v${v} r${rotation} t${step * 0.05} static ${JSON.stringify(fixed.bounds)}`;
            assert.equal(
              fixed.bvh.intersectsGeometry(moving.mesh.geometry, relative),
              false,
              label,
            );
            // Triangle intersections alone miss an airframe completely inside a closed solid.
            point
              .fromBufferAttribute(moving.mesh.geometry.attributes.position, 0)
              .applyMatrix4(relative);
            ray.origin.copy(point);
            const hits = fixed.bvh
              .raycast(ray, THREE.DoubleSide)
              .map((hit) => hit.distance)
              .sort((a, b) => a - b);
            const unique = hits.filter(
              (distance, index) => !index || Math.abs(distance - hits[index - 1]) > 1e-6,
            );
            assert.equal(unique.length % 2, 0, `airframe enclosed: ${label}`);
          }
      }
      updateFacilityActors(actors, -v, state);
      const start = plane.position.clone();
      updateFacilityActors(actors, 52 - v, state);
      assert.ok(start.distanceTo(plane.position) < 1e-9);
    }
});

test('wind and stadium variant additions stay outside the moving rotor and playing field', () => {
  for (const kind of ['wind', 'stadium'] as const)
    for (let v = 1; v < 5; v++) {
      const landmarkTile = { ...tile(v, 0), kind };
      const architecture = new THREE.Group();
      facilityArchitecture(architecture, landmarkTile);
      const fixed = meshes(architecture),
        actors = createFacilityActors(landmarkTile, state)!;
      // Static additions and actors use the same local facility frame.
      actors.children[0].position.set(0, 0, 0);
      for (let step = 0; step < 240; step++) {
        updateFacilityActors(actors, step * 0.25, state);
        for (const moving of meshes(actors))
          for (const addition of fixed) {
            if (!moving.bounds.intersectsBox(addition.bounds)) continue;
            const relative = new THREE.Matrix4().multiplyMatrices(
              addition.inverse,
              moving.mesh.matrixWorld,
            );
            assert.equal(
              addition.bvh.intersectsGeometry(moving.mesh.geometry, relative),
              false,
              `${kind} v${v} animation intersects variant architecture`,
            );
          }
      }
    }
});
