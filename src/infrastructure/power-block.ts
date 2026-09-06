import type { CityState, Tile } from '../domain/types';

const OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;
const isZone = (tile: Tile) => ['residential', 'commercial', 'industrial'].includes(tile.kind);
const isLand = (tile: Tile) =>
  tile.elevation >= 0 && !['road', 'rail', 'water'].includes(tile.kind);

/**
 * Enclosed street blocks distribute electricity internally, including across their gardens
 * and vacant lots. Roads, railways and water are hard boundaries. Open countryside that
 * reaches a map edge stays outside this mask, so a road end cannot feed the far side by
 * travelling through wilderness. Such areas still use ordinary touching-zone connections.
 * This is a logical local distribution network; it never creates visible overhead wires.
 */
export function getPowerBlockMask(state: CityState): Uint8Array {
  const visited = new Uint8Array(state.tiles.length);
  const blocks = new Uint8Array(state.tiles.length);
  for (let start = 0; start < state.tiles.length; start++) {
    if (visited[start] || !isLand(state.tiles[start])) continue;
    const cells = [start];
    visited[start] = 1;
    let enclosed = true,
      zoned = false;
    for (let cursor = 0; cursor < cells.length; cursor++) {
      const tile = state.tiles[cells[cursor]];
      if (tile.x === 0 || tile.z === 0 || tile.x === state.size - 1 || tile.z === state.size - 1)
        enclosed = false;
      if (isZone(tile)) zoned = true;
      for (const [dx, dz] of OFFSETS) {
        const x = tile.x + dx,
          z = tile.z + dz;
        if (x < 0 || z < 0 || x >= state.size || z >= state.size) continue;
        const id = z * state.size + x;
        if (visited[id] || !isLand(state.tiles[id])) continue;
        visited[id] = 1;
        cells.push(id);
      }
    }
    if (enclosed && zoned) for (const id of cells) blocks[id] = 1;
  }
  return blocks;
}
