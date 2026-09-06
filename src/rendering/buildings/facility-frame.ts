import * as THREE from 'three';
import type { Tile, Tool } from '../../domain/types';
import { box } from './primitives';
import { palette } from './materials';
import { zoneLotDimensions } from '../../buildings/lots';
export const FACILITY_FOOTPRINTS: Partial<Record<Tile['kind'], readonly [number, number]>> = {
  power: [4, 4],
  waterpump: [2, 2],
  police: [2, 2],
  fire: [3, 2],
  hospital: [3, 3],
  school: [3, 2],
  university: [5, 4],
  stadium: [6, 5],
  airport: [10, 6],
  seaport: [5, 3],
  wind: [2, 2],
  solar: [4, 3],
  recycling: [3, 3],
};
export function getModelFootprint(kind: Tool, rotation = 0): [number, number] {
  const [width, depth] = FACILITY_FOOTPRINTS[kind as Tile['kind']] ?? [1, 1];
  return Math.abs(rotation) % 2 ? [depth, width] : [width, depth];
}
export function facilityFrame(g: THREE.Group, tile: Tile): THREE.Group {
  const frame = new THREE.Group();
  const [width, depth] = tile.lotWidth
    ? zoneLotDimensions(tile)
    : getModelFootprint(tile.kind, tile.rotation);
  frame.position.set((width - 1) / 2, 0, (depth - 1) / 2);
  frame.rotation.y = (-(tile.lotWidth ? 0 : (tile.rotation ?? 0)) * Math.PI) / 2;
  g.add(frame);
  return frame;
}
export function foundation(
  g: THREE.Group,
  width: number,
  depth: number,
  color = palette.concrete,
): void {
  const base = box(g, palette.stone, 0, 0.035, 0, width - 0.06, 0.07, depth - 0.06);
  base.userData.facilityFoundation = 'base';
  const surface = box(g, color, 0, 0.076, 0, width - 0.13, 0.014, depth - 0.13);
  surface.userData.facilityFoundation = 'surface';
}
