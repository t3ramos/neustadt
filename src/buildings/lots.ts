import { effectiveZoneDensity } from './density';
import type { CityState, Point, Tile } from '../domain/types';

export const BUILDING_VARIANT_COUNT = 5;
export function buildingVariant(tile: Pick<Tile, 'variation'>): number {
  return Math.abs(tile.variation) % BUILDING_VARIANT_COUNT;
}
/** Stored dimensions are world-aligned, independent of facade orientation. */
export function zoneLotDimensions(tile: Tile): [number, number] {
  return [tile.lotWidth ?? 1, tile.lotDepth ?? 1];
}
export function zoneLotArea(tile: Tile): number {
  const [w, d] = zoneLotDimensions(tile);
  return w * d;
}
export const getBuildingVariant = buildingVariant;
export function preferredZoneLot(tile: Tile): [number, number] {
  const variant = buildingVariant(tile);
  if (tile.kind === 'residential') return variant === 4 ? [2, 2] : variant === 3 ? [2, 1] : [1, 1];
  return variant === 4 ? [3, 2] : variant === 3 ? [2, 2] : variant === 2 ? [2, 1] : [1, 1];
}
/** Atomic growth claim: only undeveloped, matching zoned land is eligible. */
export function claimZoneLot(
  state: CityState,
  tile: Tile,
  dimensions = preferredZoneLot(tile),
): boolean {
  if (
    !['residential', 'commercial', 'industrial'].includes(tile.kind) ||
    tile.anchor >= 0 ||
    tile.level !== 0 ||
    tile.variation === EASTER_EGG_BUILDING_VARIATION
  )
    return false;
  const [w, d] = dimensions;
  if (!['2x1', '1x2', '2x2', '3x2', '2x3'].includes(`${w}x${d}`)) return false;
  const members: Tile[] = [];
  for (let z = tile.z; z < tile.z + d; z++)
    for (let x = tile.x; x < tile.x + w; x++) {
      if (x >= state.size || z >= state.size) return false;
      const t = state.tiles[z * state.size + x];
      if (
        t.kind !== tile.kind ||
        effectiveZoneDensity(t) !== effectiveZoneDensity(tile) ||
        t.level !== 0 ||
        t.anchor >= 0 ||
        t.fire > 0 ||
        t.elevation !== tile.elevation
      )
        return false;
      members.push(t);
    }
  const anchor = tile.z * state.size + tile.x;
  for (const t of members) {
    Object.assign(t, {
      anchor,
      lotWidth: w,
      lotDepth: d,
      rotation: tile.rotation,
      variation: tile.variation,
      age: tile.age,
    });
    if (tile.zoneDensity === undefined) delete t.zoneDensity;
    else t.zoneDensity = tile.zoneDensity;
    if (tile.ruralCommercial === undefined) delete t.ruralCommercial;
    else t.ruralCommercial = tile.ruralCommercial;
  }
  return true;
}
export function syncZoneLot(state: CityState, tile: Tile): void {
  if (tile.anchor < 0 || !tile.lotWidth) return;
  const [w, d] = zoneLotDimensions(tile);
  for (let z = tile.z; z < tile.z + d; z++)
    for (let x = tile.x; x < tile.x + w; x++) {
      const t = state.tiles[z * state.size + x];
      if (t?.anchor === tile.anchor) {
        t.level = tile.level;
        t.age = tile.age;
        t.fire = tile.fire;
        if (tile.zoneDensity === undefined) delete t.zoneDensity;
        else t.zoneDensity = tile.zoneDensity;
        if (tile.ruralCommercial === undefined) delete t.ruralCommercial;
        else t.ruralCommercial = tile.ruralCommercial;
      }
    }
}

/** Shared by simulation and optional GLB renderer; never import Three.js into saves. */
export const EASTER_EGG_BUILDING_VARIATION = 900005;
export function isEasterEggLot(tile: Pick<Tile, 'kind' | 'variation'>): boolean {
  return tile.kind === 'commercial' && tile.variation === EASTER_EGG_BUILDING_VARIATION;
}
export interface EasterEggLotPlan {
  width: 2 | 3;
  depth: 2 | 3;
  rotation: 0 | 1 | 2 | 3;
  road: { x: number; z: number };
  clearView?: Point[];
}
/** Local +Z is the glass/logo front: south, west, north, east respectively. */
export function findEasterEggLotPlan(
  state: CityState,
  tile: Tile,
  clearView = false,
): EasterEggLotPlan | null {
  if (
    tile.kind !== 'commercial' ||
    tile.level !== 0 ||
    tile.anchor >= 0 ||
    state.tiles.some((t) => t.variation === EASTER_EGG_BUILDING_VARIATION)
  )
    return null;
  const plans: (EasterEggLotPlan & { roads: number })[] = [];
  for (const rotation of [0, 1, 2, 3] as const) {
    const width = rotation % 2 ? 2 : 3,
      depth = rotation % 2 ? 3 : 2;
    let free = true;
    for (let z = tile.z; z < tile.z + depth; z++)
      for (let x = tile.x; x < tile.x + width; x++) {
        const t =
          x >= 0 && z >= 0 && x < state.size && z < state.size
            ? state.tiles[z * state.size + x]
            : undefined;
        if (
          !t ||
          t.kind !== 'commercial' ||
          effectiveZoneDensity(t) !== effectiveZoneDensity(tile) ||
          t.level !== 0 ||
          t.anchor >= 0 ||
          t.fire !== 0 ||
          t.elevation !== tile.elevation
        )
          free = false;
      }
    if (!free) continue;
    const roads: { x: number; z: number }[] = [];
    for (let n = 0; n < (rotation % 2 ? depth : width); n++) {
      const x = rotation === 1 ? tile.x - 1 : rotation === 3 ? tile.x + width : tile.x + n;
      const z = rotation === 0 ? tile.z + depth : rotation === 2 ? tile.z - 1 : tile.z + n;
      const road =
        x >= 0 && z >= 0 && x < state.size && z < state.size
          ? state.tiles[z * state.size + x]
          : undefined;
      if (road?.kind === 'road' && Math.abs(road.elevation - tile.elevation) <= 0.5)
        roads.push({ x, z });
    }
    const sightline: Point[] = [];
    if (clearView) {
      // A widening foreground keeps the facade visible from both diagonal camera angles.
      // Row one is the road. The land beyond becomes a permanent landscaped forecourt.
      if (roads.length !== (rotation % 2 ? depth : width)) continue;
      for (let distance = 1; distance <= 5; distance++)
        for (let lateral = -distance; lateral < 3 + distance; lateral++) {
          const x =
            rotation === 1
              ? tile.x - distance
              : rotation === 3
                ? tile.x + width - 1 + distance
                : tile.x + lateral;
          const z =
            rotation === 0
              ? tile.z + depth - 1 + distance
              : rotation === 2
                ? tile.z - distance
                : tile.z + lateral;
          const t =
            x >= 0 && z >= 0 && x < state.size && z < state.size
              ? state.tiles[z * state.size + x]
              : undefined;
          if (
            !t ||
            !['empty', 'tree', 'park', 'water', 'road', 'beach'].includes(t.kind) ||
            t.elevation > tile.elevation + 0.5
          )
            free = false;
          sightline.push({ x, z });
        }
      if (!free) continue;
    }
    if (roads.length)
      plans.push({
        width,
        depth,
        rotation,
        road: roads[Math.floor(roads.length / 2)],
        roads: roads.length,
        ...(clearView ? { clearView: sightline } : {}),
      });
  }
  plans.sort((a, b) => b.roads - a.roads || a.rotation - b.rotation);
  const selected = plans[0];
  if (!selected) return null;
  const { roads: _roads, ...plan } = selected;
  return plan;
}
export function claimEasterEggLot(state: CityState, tile: Tile, clearView = false): boolean {
  const plan = findEasterEggLotPlan(state, tile, clearView);
  if (!plan) return false;
  if (!claimZoneLot(state, tile, [plan.width, plan.depth])) return false;
  for (let z = tile.z; z < tile.z + plan.depth; z++)
    for (let x = tile.x; x < tile.x + plan.width; x++) {
      const member = state.tiles[z * state.size + x];
      Object.assign(member, { variation: EASTER_EGG_BUILDING_VARIATION, rotation: plan.rotation });
      delete member.ruralCommercial;
    }
  for (const p of plan.clearView ?? []) {
    const t = state.tiles[p.z * state.size + p.x];
    if (['empty', 'tree', 'park'].includes(t.kind)) {
      t.kind = 'park';
      t.variation = 3; // Low planted beds, never foreground trees.
    }
  }
  return true;
}

/** The fourth eligible medium business opening is the unique local landmark. */
export function tryEarlyEasterEggLot(state: CityState, tile: Tile): boolean {
  if (effectiveZoneDensity(tile) !== 'medium' || !findEasterEggLotPlan(state, tile, true))
    return false;
  const key = 'mediumCommercialLandmarkSites';
  state.progression.counters[key] = (state.progression.counters[key] ?? 0) + 1;
  return state.progression.counters[key] >= 4 && claimEasterEggLot(state, tile, true);
}
