import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Tile } from '../../domain/types';
import { isEasterEggLot } from '../../buildings/lots';
import { createLandmarkOfficeDetails } from './landmark-office';
export { EASTER_EGG_BUILDING_VARIATION } from '../../buildings/lots';

export const EASTER_EGG_BUILDING_ASSET_URL = `${import.meta.env?.BASE_URL ?? '/'}assets/models/easter-egg-office.glb`;
let template: THREE.Group | undefined;
let pending: Promise<void> | undefined;

export function isEasterEggBuilding(tile: Pick<Tile, 'kind' | 'variation'>): boolean {
  return isEasterEggLot(tile);
}

/** Await before creating the city. Failures propagate so public QA cannot hide a missing asset. */
export function preloadEasterEggBuilding(): Promise<void> {
  if (template) return Promise.resolve();
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(EASTER_EGG_BUILDING_ASSET_URL)
      .then((gltf) => {
        template = gltf.scene;
        template.name = 'Easter Egg office source';
        template.add(createLandmarkOfficeDetails());
        template.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          object.geometry.userData.easterEggShared = true;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            material.userData.easterEggShared = true;
            if (
              material instanceof THREE.MeshStandardMaterial &&
              material.name === 'Easter Egg glass'
            ) {
              material.userData.glazing = true;
            }
          }
        });
      })
      .catch((error) => {
        pending = undefined;
        throw new Error('Easter Egg office asset could not be loaded', { cause: error });
      });
  }
  return pending;
}

/**
 * 3×2 commercial anchor: X[-.5,2.5], Z[-.5,1.5], ground Y=0; front faces +Z.
 * Geometry/materials are cached and shared, safe to merge using cloned geometry.
 * Includes finished rear/sides and a thin ground apron. Street access is supplied by the lot renderer.
 * Returns null before preload; caller can use the normal commercial appearance during optional previews.
 */
export function createEasterEggBuilding(): THREE.Group | null {
  if (!template) return null;
  const group = template.clone(true);
  group.name = 'Easter Egg office';
  group.position.set(1, 0, 0.5);
  group.userData.landmark = 'easterEgg';
  group.userData.sourceAsset = EASTER_EGG_BUILDING_ASSET_URL;
  return group;
}

/** Only call once no live city, preview or merged batch refers to the cached materials. */
export function disposeEasterEggBuildingAssets(): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  template?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  template = undefined;
  pending = undefined;
}
