import * as THREE from 'three';
import type { CityState } from '../../domain/types';
import { buildLandscapeChunk, landscapeChunkSignature } from '../world/landscape';
import { createRegionContext } from '../world/surroundings';
import {
  buildTerrainChunk,
  buildTerrainSkirt,
  terrainChunkSignature,
  createTerrainMaterials,
} from '../world/terrain';
import { disposeGroup } from './geometry';

const EDGE = 16;
type Chunk = { signature: string; group: THREE.Group };
/** Owns the static land meshes, boundary context and instanced vegetation.
 * The caller only needs to refresh picking/grid surfaces when terrain changes. */
export function createWorldChunks(
  terrain: THREE.Group,
  forests: THREE.Group,
  materials: ReturnType<typeof createTerrainMaterials>,
) {
  const ground = new Map<string, Chunk>(),
    landscape = new Map<string, Chunk>();
  let skirt: THREE.Group | undefined, context: THREE.Group | undefined;
  function disposeLandscape(group: THREE.Group) {
    group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        object.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) =>
          material.dispose(),
        );
      }
    });
    disposeGroup(group);
  }
  return {
    updateTerrain(state: CityState): boolean {
      let changed = false;
      for (let cz = 0; cz < state.size; cz += EDGE)
        for (let cx = 0; cx < state.size; cx += EDGE) {
          const key = `${cx}:${cz}`,
            signature = terrainChunkSignature(state, cx, cz, EDGE),
            previous = ground.get(key);
          if (previous?.signature === signature) continue;
          const group = buildTerrainChunk(state, cx, cz, EDGE, materials);
          terrain.add(group);
          ground.set(key, { signature, group });
          if (previous) disposeGroup(previous.group);
          changed = true;
        }
      if (!changed) return false;
      if (skirt) {
        for (const material of skirt.userData.ownedMaterials ?? []) material.dispose();
        disposeGroup(skirt);
      }
      skirt = buildTerrainSkirt(state, materials.earth);
      terrain.add(skirt);
      if (context) {
        for (const material of context.userData.ownedMaterials ?? []) material.dispose();
        disposeGroup(context);
      }
      context = createRegionContext(state, materials);
      terrain.add(context);
      return true;
    },
    updateLandscape(state: CityState) {
      for (let cz = 0; cz < state.size; cz += EDGE)
        for (let cx = 0; cx < state.size; cx += EDGE) {
          const key = `${cx}:${cz}`,
            signature = landscapeChunkSignature(state, cx, cz, EDGE),
            previous = landscape.get(key);
          if (previous?.signature === signature) continue;
          const group = buildLandscapeChunk(state, cx, cz, EDGE);
          forests.add(group);
          landscape.set(key, { signature, group });
          if (previous) disposeLandscape(previous.group);
        }
    },
  };
}
