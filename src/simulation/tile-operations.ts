/** Low-level tile and whole-footprint mutations shared by simulation commands. */
import { EASTER_EGG_BUILDING_VARIATION } from '../buildings/lots';
import type { CityState, Point, Tile, TileKind } from '../domain/types';
import { dimensions, getFootprint, point, random, terrainKind, tileAt } from './city-queries';

export function newTile(
  x: number,
  z: number,
  seed: number,
  elevation: number,
  kind: TileKind = elevation < 0 ? 'water' : 'empty',
): Tile {
  return {
    x,
    z,
    kind,
    level: 0,
    variation: Math.floor(random(seed, x, z) * 1000),
    powered: false,
    watered: false,
    connected: false,
    pollution: 0,
    landValue: 55,
    traffic: 0,
    fire: 0,
    age: 0,
    elevation,
    hasPipe: false,
    hasPowerLine: false,
    anchor: -1,
    rotation: 0,
  };
}

export function clearTile(t: Tile, clearUtilities = false): void {
  if (t.variation === EASTER_EGG_BUILDING_VARIATION) t.variation = (t.x * 37 + t.z * 71) % 1000;
  t.kind = terrainKind(t);
  t.level = 0;
  t.age = 0;
  t.fire = 0;
  t.anchor = -1;
  t.rotation = 0;
  delete t.lotWidth;
  delete t.lotDepth;
  delete t.ruralCommercial;
  delete t.zoneDensity;
  if (clearUtilities) {
    t.hasPipe = false;
    t.hasPowerLine = false;
  }
}

export function placeFacility(
  state: CityState,
  p: Point,
  kind: TileKind,
  rotation: 0 | 1 | 2 | 3 = 0,
): void {
  const [w, d] = dimensions(kind, rotation);
  const anchor = p.z * state.size + p.x;
  for (let z = p.z; z < p.z + d; z++)
    for (let x = p.x; x < p.x + w; x++) {
      const t = tileAt(state, x, z)!;
      t.kind = kind;
      t.anchor = anchor;
      t.rotation = rotation;
      t.level = 1;
      t.fire = 0;
      t.age = 0;
      delete t.ruralCommercial;
      delete t.zoneDensity;
    }
}

export function connectFacility(state: CityState, p: Point): void {
  const root = tileAt(state, p.x, p.z)!;
  const members = getFootprint(state, root);
  let best: Point | null = null;
  let edge: Point = p;
  let distance = Infinity;
  const roads = state.tiles.filter((t) => t.kind === 'road');
  for (const a of members)
    for (const r of roads) {
      const d = Math.abs(a.x - r.x) + Math.abs(a.z - r.z);
      if (d < distance) {
        distance = d;
        best = point(r);
        edge = a;
      }
    }
  if (!best) return;
  let x = edge.x;
  let z = edge.z;
  const connect = () => {
    const t = tileAt(state, x, z)!;
    t.hasPipe = true;
    t.hasPowerLine = true;
    if (['empty', 'tree', 'rubble'].includes(t.kind)) t.kind = 'road';
  };
  connect();
  while (x !== best.x) {
    x += Math.sign(best.x - x);
    connect();
  }
  while (z !== best.z) {
    z += Math.sign(best.z - z);
    connect();
  }
}

export function destroyBuilding(state: CityState, t: Tile): void {
  for (const p of getFootprint(state, t)) {
    const f = tileAt(state, p.x, p.z)!;
    if (f.variation === EASTER_EGG_BUILDING_VARIATION) f.variation = (f.x * 37 + f.z * 71) % 1000;
    f.kind = 'rubble';
    f.level = 0;
    f.fire = 0;
    f.age = 0;
    f.anchor = -1;
    f.rotation = 0;
    delete f.lotWidth;
    delete f.lotDepth;
    delete f.ruralCommercial;
    delete f.zoneDensity;
    f.hasPowerLine = false;
    f.hasPipe = false;
  }
}
