import * as THREE from 'three';
import type { TerrainMaterials } from './terrain';
import type { CityState } from '../../domain/types';

/** The world ends at its playable edge. Kept for weather and camera extent callers. */
export const getRegionMargin = (_size: number): number => 0;

/** Compatibility container: the finite terrain plate supplies the visible boundary.
 * Deliberately no ground, vegetation or ocean extension outside the saved city. */
export function createRegionContext(_state: CityState, _materials: TerrainMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'region-context';
  group.userData.nonBuildable = true;
  group.userData.ownedMaterials = [];
  return group;
}
