import type { CityState, Point, Tile } from '../domain/types';
import { recalculate } from '../simulation/economy';
import {
  claimEasterEggLot,
  EASTER_EGG_BUILDING_VARIATION,
  findEasterEggLotPlan,
  syncZoneLot,
} from './lots';

export interface EasterEggRelocation {
  city: CityState;
  from: Point;
  to: Point;
  changedTiles: number[];
}
const vacant = (tile: Tile) =>
  tile.anchor < 0 && tile.elevation >= 0 && ['empty', 'tree', 'park'].includes(tile.kind);
function landscape(tile: Tile): void {
  Object.assign(tile, {
    kind: 'park',
    level: 0,
    variation: 3,
    age: 0,
    fire: 0,
    anchor: -1,
    rotation: 0,
  });
  delete tile.lotWidth;
  delete tile.lotDepth;
  delete tile.ruralCommercial;
  delete tile.zoneDensity;
}

/** Explicit relocation command only: input and all unrelated city state stay untouched.
 * The caller owns preview, saving and applying the returned copy. Never run on load.
 */
export function relocateEasterEggToPark(
  state: CityState,
  preferred?: Point,
): EasterEggRelocation | null {
  const original = state.tiles.filter((t) => t.variation === EASTER_EGG_BUILDING_VARIATION);
  const root = original.find((t) => t.anchor === t.z * state.size + t.x);
  if (!root || original.length !== 6 || original.some((t) => t.anchor !== root.anchor)) return null;
  const city = structuredClone(state);
  for (const t of original) landscape(city.tiles[t.z * city.size + t.x]);
  const candidates: { x: number; z: number; w: number; d: number; score: number }[] = [];
  for (const t of city.tiles) {
    if (preferred && (t.x !== preferred.x || t.z !== preferred.z)) continue;
    if (!vacant(t)) continue;
    for (const [w, d] of [
      [3, 2],
      [2, 3],
    ]) {
      if (t.x + w > city.size || t.z + d > city.size) continue;
      const members: Tile[] = [];
      for (let dz = 0; dz < d; dz++)
        for (let dx = 0; dx < w; dx++) members.push(city.tiles[(t.z + dz) * city.size + t.x + dx]);
      if (!members.every((m) => vacant(m) && m.elevation === t.elevation)) continue;
      const previous = members.map((m) => ({ ...m }));
      for (const m of members)
        Object.assign(m, { kind: 'commercial', level: 0, zoneDensity: 'medium' });
      const plan = findEasterEggLotPlan(city, t, true);
      for (let i = 0; i < members.length; i++) {
        Object.assign(members[i], previous[i]);
        if (previous[i].zoneDensity === undefined) delete members[i].zoneDensity;
      }
      if (!plan || plan.width !== w || plan.depth !== d) continue;
      const park = plan.clearView!.filter(
        (p) => state.tiles[p.z * state.size + p.x].kind === 'park',
      ).length;
      if (park < 6) continue;
      // Prefer the broadest existing park frontage, then proximity to the original business.
      const score = park * 100 - Math.hypot(t.x - root.x, t.z - root.z);
      candidates.push({ x: t.x, z: t.z, w, d, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.z - b.z || a.x - b.x);
  const selected = candidates[0];
  if (!selected) return null;
  for (let dz = 0; dz < selected.d; dz++)
    for (let dx = 0; dx < selected.w; dx++) {
      const t = city.tiles[(selected.z + dz) * city.size + selected.x + dx];
      landscape(t);
      Object.assign(t, { kind: 'commercial', zoneDensity: 'medium', variation: 4 });
    }
  const destination = city.tiles[selected.z * city.size + selected.x];
  if (!claimEasterEggLot(city, destination, true)) return null;
  destination.level = Math.min(2, Math.max(1, root.level));
  destination.age = root.age;
  syncZoneLot(city, destination);
  recalculate(city);
  const changedTiles = city.tiles.flatMap((t, i) =>
    JSON.stringify(t) !== JSON.stringify(state.tiles[i]) ? [i] : [],
  );
  if (changedTiles.length) city.revision++;
  return {
    city,
    from: { x: root.x, z: root.z },
    to: { x: destination.x, z: destination.z },
    changedTiles,
  };
}
