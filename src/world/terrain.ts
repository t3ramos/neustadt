/** Persisted tile heights are authoritative after generation, including legacy saves. */
export const TERRAIN_STEP = 0.5;
export const MIN_ELEVATION = -2;
export const MAX_ELEVATION = 12;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
export function landscapeHash(x: number, z: number, seed: number): number {
  let h =
    Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function landscapeNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    u = smooth(x - ix),
    v = smooth(z - iz);
  const a = landscapeHash(ix, iz, seed),
    b = landscapeHash(ix + 1, iz, seed),
    c = landscapeHash(ix, iz + 1, seed),
    d = landscapeHash(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export function legacyWaterTerrain(x: number, z: number): boolean {
  const shoreline = 32 + Math.round(Math.sin((z + 4) * 0.19) * 1.7 + Math.sin(z * 0.53) * 0.6);
  return x >= shoreline || (z >= 34 && x >= 29 - Math.floor((z - 34) / 2));
}
/** A low central basin opens east onto an estuary; ridges enclose north and south. */
export function getTerrainElevation(x: number, z: number, size = 128, seed = 2026): number {
  const u = (x + 0.5) / size,
    v = (z + 0.5) / size;
  const phase = landscapeHash(0, 0, seed) * 6.28;
  const coast = 0.82 + 0.035 * Math.sin(v * 12 + phase) + 0.022 * Math.sin(v * 27 + phase);
  const inlet = Math.max(0, v - 0.7) * 0.55;
  const distance = (coast - inlet - u) * size;
  if (distance < 0) return Math.max(MIN_ELEVATION, Math.round((-0.5 + distance * 0.22) * 2) / 2);
  const north = Math.exp(-Math.pow((v - (0.1 + 0.035 * Math.sin(u * 9 + phase))) / 0.13, 2));
  const south = Math.exp(-Math.pow((v - (0.91 + 0.045 * Math.sin(u * 10 + phase))) / 0.16, 2));
  const west = Math.exp(-Math.pow((u - 0.025) / 0.095, 2));
  const peaks = 0.62 + 0.55 * landscapeNoise(u * 6, v * 6, seed + 71);
  const ridges = (north * 8.6 + south * 9.8 + west * 4.8) * peaks;
  const valley =
    1 - 0.55 * Math.exp(-Math.pow((u - (0.24 + 0.065 * Math.sin(v * 7 + phase))) / 0.07, 2));
  // The clear central floor gives a new town enough room for roads and large facilities.
  // Full-sized founding maps reserve a broad valley: over fifty clear fields in each
  // direction, with the north/south massifs still rising outside this central floor.
  // Smaller authored/legacy-sized worlds retain their established landscape.
  const basinWidth = size >= 128 ? 0.31 : 0.28;
  const basinDepth = size >= 128 ? 0.3 : 0.24;
  const basin = Math.max(Math.abs(u - 0.45) / basinWidth, Math.abs(v - 0.46) / basinDepth);
  const edge = smooth((basin - 0.8) / 0.55);
  const shore = smooth(distance / Math.max(2, size * 0.055));
  const hill = Math.max(0, ridges * valley * edge * shore);
  return Math.min(MAX_ELEVATION, Math.round(hill * 2) / 2);
}
/** Coherent stands with irregular glades, rather than independent random tree tiles. */
export function isForestTerrain(x: number, z: number, size: number, seed: number): boolean {
  const elevation = getTerrainElevation(x, z, size, seed);
  if (elevation < 0 || elevation > 8.5) return false;
  const u = (x + 0.5) / size,
    v = (z + 0.5) / size;
  const clearingRadius = size >= 128 ? 0.22 : 0.14;
  if (Math.abs(u - 0.45) < clearingRadius && Math.abs(v - 0.46) < clearingRadius) return false;
  const stand =
    landscapeNoise(u * 7, v * 7, seed + 37) * 0.75 +
    landscapeNoise(u * 19, v * 19, seed + 19) * 0.25;
  return stand > 0.43 && landscapeHash(x, z, seed + 93) > 0.055;
}
/** Compatibility helper. Live construction/rendering must instead read tile.elevation. */
export function isWaterTerrain(x: number, z: number, size = 40, seed = 2026): boolean {
  return getTerrainElevation(x, z, size, seed) < 0;
}
