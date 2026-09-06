import type { Tile, ZoneDensity } from '../domain/types';

export const ZONE_DENSITIES: readonly ZoneDensity[] = ['low', 'medium', 'high'];
/** Missing density is the unrestricted zoning used by existing saved cities. */
export function effectiveZoneDensity(tile: Pick<Tile, 'zoneDensity'>): ZoneDensity {
  return tile.zoneDensity ?? 'high';
}
export function zoneDensityCap(tile: Pick<Tile, 'zoneDensity'>): number {
  return { low: 1, medium: 2, high: 4 }[effectiveZoneDensity(tile)];
}
