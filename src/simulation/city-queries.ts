/** Pure tile, ownership, footprint and deterministic value queries. */
import { zoneLotDimensions } from '../buildings/lots';
import type { CityState, Point, Tile, TileKind, Tool } from '../domain/types';
import { TOOL_DEFS, ZONES } from './catalog';

export const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));

export const inBounds = (state: CityState, x: number, z: number) =>
  Number.isInteger(x) &&
  Number.isInteger(z) &&
  x >= 0 &&
  z >= 0 &&
  x < state.size &&
  z < state.size;

export const tileAt = (state: CityState, x: number, z: number): Tile | undefined =>
  inBounds(state, x, z) ? state.tiles[z * state.size + x] : undefined;

export const isZone = (kind: TileKind) => ZONES.includes(kind);

export const isFacility = (kind: TileKind) => !!TOOL_DEFS[kind]?.footprint;

export const isBuilding = (kind: TileKind) => isZone(kind) || isFacility(kind);

export const hasStructure = (tile: Tile) =>
  isBuilding(tile.kind) && (!isZone(tile.kind) || tile.level > 0);

export const point = (t: Point): Point => ({ x: t.x, z: t.z });

export const terrainKind = (t: Tile): TileKind => (t.elevation < 0 ? 'water' : 'empty');

export function random(seed: number, a: number, b = 0, c = 0): number {
  let n =
    (seed ^
      Math.imul(a + 31, 374761393) ^
      Math.imul(b + 17, 668265263) ^
      Math.imul(c + 1, 1274126177)) |
    0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function isBuildingAnchor(state: CityState, tile: Tile): boolean {
  return tile.anchor < 0 || tile.anchor === tile.z * state.size + tile.x;
}

export function getFootprint(state: CityState, tile: Tile): Point[] {
  if (tile.anchor < 0) return [point(tile)];
  const root = state.tiles[tile.anchor];
  if (!root) return [point(tile)];
  const [w, d] = isZone(root.kind) ? zoneLotDimensions(root) : dimensions(root.kind, root.rotation);
  const out: Point[] = [];
  for (let z = root.z; z < root.z + d; z++)
    for (let x = root.x; x < root.x + w; x++) {
      const t = tileAt(state, x, z);
      if (t && t.anchor === tile.anchor) out.push({ x, z });
    }
  return out.length ? out : [point(tile)];
}

export function dimensions(tool: Tool, rotation = 0): [number, number] {
  const [w, d] = TOOL_DEFS[tool]?.footprint ?? [1, 1];
  return rotation % 2 ? [d, w] : [w, d];
}

export function rootTile(state: CityState, t: Tile): Tile {
  return t.anchor >= 0 ? (state.tiles[t.anchor] ?? t) : t;
}
