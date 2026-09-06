import { FACILITY_FOOTPRINTS } from './facility-frame';
import { getFacilityAccess } from '../../buildings/facility-access';
import * as THREE from 'three';
import type { CityState, Tile } from '../../domain/types';
import { box, cylinder, slab } from './primitives';
import { palette, modelMaterial } from './materials';
import { roadSurfaceMaterial, textureAsphalt } from '../infrastructure/road-surface';
import { roadBend, roadBendGeometry } from '../infrastructure/roads';
export function road(g: THREE.Group, tile: Tile, state: CityState): void {
  const connects = (dx: number, dz: number): boolean => {
    const x = tile.x + dx,
      z = tile.z + dz;
    if (x < 0 || z < 0 || x >= state.size || z >= state.size) return false;
    return state.tiles[z * state.size + x]?.kind === 'road';
  };
  const north = connects(0, -1),
    east = connects(1, 0),
    south = connects(0, 1),
    west = connects(-1, 0);
  const horizontal = east || west;
  const vertical = north || south;
  const count = Number(north) + Number(east) + Number(south) + Number(west);
  const mask = Number(north) | (Number(east) << 1) | (Number(south) << 2) | (Number(west) << 3);
  slab(g, palette.sidewalk, 1, 1);
  if (roadBend(mask)) {
    const asphalt = new THREE.Mesh(
      roadBendGeometry(mask, -0.335, 0.335, 0.0455, 0.0205),
      modelMaterial(palette.asphalt),
    );
    asphalt.name = 'road-rounded-bend';
    asphalt.receiveShadow = true;
    g.add(asphalt);
    for (const [left, right] of [
      [-0.365, -0.335],
      [0.335, 0.365],
    ]) {
      const curb = new THREE.Mesh(
        roadBendGeometry(mask, left, right, 0.055, 0.0205),
        modelMaterial(palette.sidewalk),
      );
      curb.name = 'road-rounded-curb';
      curb.receiveShadow = true;
      g.add(curb);
    }
  } else {
    box(g, palette.asphalt, 0, 0.033, 0, 0.67, 0.025, 0.67);
    if (north || (!horizontal && !vertical))
      box(g, palette.asphalt, 0, 0.033, -0.33, 0.67, 0.025, 0.34);
    if (south || (!horizontal && !vertical))
      box(g, palette.asphalt, 0, 0.033, 0.33, 0.67, 0.025, 0.34);
    if (east) box(g, palette.asphalt, 0.33, 0.033, 0, 0.34, 0.025, 0.67);
    if (west) box(g, palette.asphalt, -0.33, 0.033, 0, 0.34, 0.025, 0.67);
  }
  // A property's selected gate opens the curb at its real lane position.
  // It is a driveway, so it never invents another arm in intersection markings.
  for (const [dx, dz] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    const x = tile.x + dx,
      z = tile.z + dz;
    if (x < 0 || z < 0 || x >= state.size || z >= state.size) continue;
    const neighbor = state.tiles[z * state.size + x];
    if (
      !FACILITY_FOOTPRINTS[neighbor.kind] &&
      !(neighbor.kind === 'industrial' && neighbor.level > 0)
    )
      continue;
    const access = getFacilityAccess(state, neighbor);
    if (
      !access?.connected ||
      access.road?.x !== tile.x ||
      access.road.z !== tile.z ||
      access.previous?.x !== x ||
      access.previous.z !== z
    )
      continue;
    const end = access.points[access.points.length - 1];
    const offsetX = end.x - (tile.x - state.size / 2 + 0.5);
    const offsetZ = end.z - (tile.z - state.size / 2 + 0.5);
    // A driveway on the unused side of a bend must reach the curved ribbon,
    // rather than stop at the edge of the former square centre slab.
    const apronLength = roadBend(mask) ? 0.5 : 0.185;
    const apronCenter = 0.5 - apronLength / 2;
    const apron = box(
      g,
      palette.asphalt,
      dx ? dx * apronCenter : offsetX,
      0.033,
      dz ? dz * apronCenter : offsetZ,
      dx ? apronLength : access.laneWidth,
      0.025,
      dz ? apronLength : access.laneWidth,
    );
    apron.name = 'road-facility-apron';
    apron.userData.drivingSurface = true;
  }
  const surface = roadSurfaceMaterial(state, tile);
  for (const child of g.children)
    if (child instanceof THREE.Mesh && child.material === modelMaterial(palette.asphalt))
      textureAsphalt(child, surface);
  if ((tile.x + tile.z) % 6 === 0) {
    cylinder(g, palette.dark, -0.413, 0.265, 0.405, 0.025, 0.48);
    box(g, palette.dark, -0.343, 0.505, 0.405, 0.16, 0.025, 0.035);
    box(g, palette.cream, -0.275, 0.49, 0.405, 0.07, 0.024, 0.052);
  }
}
export function rail(g: THREE.Group, tile: Tile, state: CityState): void {
  const isRail = (x: number, z: number) =>
    x >= 0 &&
    z >= 0 &&
    x < state.size &&
    z < state.size &&
    state.tiles[z * state.size + x]?.kind === 'rail';
  const horizontal = isRail(tile.x - 1, tile.z) || isRail(tile.x + 1, tile.z);
  box(g, 0x9b9b84, 0, 0.018, 0, 0.52, 0.036, 1);
  for (let i = 0; i < 7; i++) box(g, palette.wood, 0, 0.052, -0.45 + i * 0.15, 0.39, 0.035, 0.065);
  box(g, palette.rail, -0.125, 0.079, 0, 0.033, 0.027, 1);
  box(g, palette.rail, 0.125, 0.079, 0, 0.033, 0.027, 1);
  if (horizontal) g.rotation.y = Math.PI / 2;
}
// All civic models are authored at their real footprint scale. Local origin is
// the footprint centre; facilityFrame later places that centre over its anchor.
