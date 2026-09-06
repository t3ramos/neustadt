import type { CityState, Tile } from '../domain/types';
import { isEasterEggLot, zoneLotArea } from '../buildings/lots';
import { landscapeHash } from './terrain';

export interface RuralityField {
  readonly distance: Uint16Array;
  readonly residentialTopology: number;
  readonly size: number;
}
interface Cache {
  revision: number;
  tiles: Tile[];
  field: RuralityField;
}
const caches = new WeakMap<CityState, Cache>();
/** One linear scan per simulation revision; the distance transform is rebuilt only when housing appears/disappears. */
export function getRuralityField(state: CityState): RuralityField {
  let cache = caches.get(state);
  if (cache && cache.revision === state.revision && cache.tiles === state.tiles) return cache.field;
  let topology = 2166136261;
  const homes: number[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.kind === 'residential' && t.level > 0) {
      homes.push(i);
      topology = Math.imul(topology ^ i, 16777619);
    }
  }
  topology = topology >>> 0;
  if (
    !cache ||
    cache.field.residentialTopology !== topology ||
    cache.field.size !== state.size ||
    cache.tiles !== state.tiles
  ) {
    const distance = new Uint16Array(state.tiles.length).fill(65535),
      queue = new Int32Array(state.tiles.length);
    let head = 0,
      tail = 0;
    for (const i of homes) {
      distance[i] = 0;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++],
        x = i % state.size,
        z = Math.floor(i / state.size),
        d = distance[i] + 1;
      for (const next of [
        x > 0 ? i - 1 : -1,
        x + 1 < state.size ? i + 1 : -1,
        z > 0 ? i - state.size : -1,
        z + 1 < state.size ? i + state.size : -1,
      ])
        if (next >= 0 && distance[next] > d) {
          distance[next] = d;
          queue[tail++] = next;
        }
    }
    cache = {
      revision: state.revision,
      tiles: state.tiles,
      field: { distance, residentialTopology: topology, size: state.size },
    };
    caches.set(state, cache);
  } else cache.revision = state.revision;
  return cache.field;
}
/** Called only by city generation or the first growth of a newly zoned parcel. No state mutation. */
export function shouldAssignRuralCommercial(state: CityState, tile: Tile): boolean {
  if (
    tile.kind !== 'commercial' ||
    tile.level > 2 ||
    isEasterEggLot(tile) ||
    tile.anchor !== tile.z * state.size + tile.x ||
    ![4, 6].includes(zoneLotArea(tile))
  )
    return false;
  const field = getRuralityField(state),
    [width, depth] = [tile.lotWidth ?? 1, tile.lotDepth ?? 1];
  let nearest = 65535;
  for (let z = tile.z; z < tile.z + depth; z++)
    for (let x = tile.x; x < tile.x + width; x++)
      nearest = Math.min(nearest, field.distance[z * state.size + x]);
  return (
    landscapeHash(tile.x, tile.z, state.seed + 719) < Math.max(0, Math.min(1, (nearest - 12) / 10))
  );
}
/** Rendering reads the saved parcel character; density and neighboring construction cannot change it. */
export function isRuralCommercial(state: CityState, tile: Tile): boolean {
  return (
    tile.ruralCommercial === true &&
    tile.kind === 'commercial' &&
    tile.level > 0 &&
    !isEasterEggLot(tile) &&
    tile.anchor === tile.z * state.size + tile.x &&
    [4, 6].includes(zoneLotArea(tile))
  );
}
