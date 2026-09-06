import assert from 'node:assert/strict';
import test from 'node:test';
import { build, createCity, deserializeCity, getFootprint, previewBuild, recalculate, serializeCity } from '../src/simulation.ts';
import { getTerrainElevation, MAX_ELEVATION, MIN_ELEVATION, TERRAIN_STEP } from '../src/terrain.ts';
import type { CityState, Point, Tool } from '../src/types.ts';

const tileAt = (city: CityState, x: number, z: number) => city.tiles[z * city.size + x];
const ground = (): CityState => {
  const city = createCity(99, true, 40);
  for (const tile of city.tiles) {
    tile.kind = 'empty'; tile.elevation = 1; tile.anchor = -1;
    tile.hasPipe = false; tile.hasPowerLine = false;
  }
  for (const tool of ['raise', 'lower', 'level', 'airport'] as Tool[]) if (!city.progression.unlocked.includes(tool)) city.progression.unlocked.push(tool);
  recalculate(city);
  return city;
};
const point: Point = { x: 12, z: 12 };

test('terrain generation is deterministic, bounded, and includes actual hills and coast', () => {
  const values: number[] = [];
  for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) {
    const elevation = getTerrainElevation(x, z, 128, 44);
    assert.equal(elevation, getTerrainElevation(x, z, 128, 44));
    assert.ok(elevation >= MIN_ELEVATION && elevation <= MAX_ELEVATION);
    values.push(elevation);
  }
  assert.ok(values.some(value => value < 0));
  assert.ok(values.some(value => value >= 2));
  assert.ok(new Set(values).size > 4);
});

test('raising and lowering terrain changes elevation by a half-level with exact brush cost', () => {
  const city = ground(), tile = tileAt(city, point.x, point.z), money = city.money;
  const preview = previewBuild(city, [point, point], 'raise');
  assert.equal(preview.cost, 35); assert.equal(preview.valid.length, 1);
  const up = build(city, [point, point], 'raise');
  assert.ok(up.ok, up.message); assert.equal(up.cost, preview.cost); assert.equal(up.count, 1);
  assert.equal(tile.elevation, 1 + TERRAIN_STEP);
  const down = build(city, [point], 'lower');
  assert.ok(down.ok, down.message); assert.equal(tile.elevation, 1);
  assert.equal(city.money, money - up.cost - down.cost);
});

test('lowering below sea level creates water and raising it back creates buildable land', () => {
  const city = ground(), tile = tileAt(city, point.x, point.z);
  tile.elevation = 0;
  assert.ok(build(city, [point], 'lower').ok);
  assert.equal(tile.elevation, -TERRAIN_STEP); assert.equal(tile.kind, 'water');
  const money = city.money;
  assert.equal(build(city, [point], 'residential').ok, false); assert.equal(city.money, money);
  assert.ok(build(city, [point], 'raise').ok);
  assert.equal(tile.elevation, 0); assert.equal(tile.kind, 'empty');
  assert.ok(build(city, [point], 'residential').ok);
});

test('level uses an explicit target across a brush and charges only actual earth moved', () => {
  const city = ground();
  const points = [{ x: 10, z: 10 }, { x: 11, z: 10 }, { x: 12, z: 10 }];
  tileAt(city, 10, 10).elevation = 0; tileAt(city, 11, 10).elevation = 1; tileAt(city, 12, 10).elevation = 2;
  const before = JSON.stringify(city);
  const preview = previewBuild(city, points, 'level', { targetElevation: 1 });
  assert.equal(JSON.stringify(city), before);
  assert.equal(preview.cost, 140);
  const result = build(city, points, 'level', { targetElevation: 1 });
  assert.ok(result.ok, result.message); assert.equal(result.cost, preview.cost);
  for (const point of points) assert.equal(tileAt(city, point.x, point.z).elevation, 1);
  const money = city.money;
  assert.equal(build(city, points, 'level', { targetElevation: 1 }).ok, false);
  assert.equal(city.money, money);
});

test('level can use the first brush tile as the terrain reference', () => {
  const city = ground(), points = [{ x: 10, z: 10 }, { x: 11, z: 10 }];
  tileAt(city, 10, 10).elevation = 2;
  const result = build(city, points, 'level');
  assert.ok(result.ok, result.message); assert.equal(result.cost, 70);
  assert.equal(tileAt(city, 11, 10).elevation, 2);
});

test('terrain edits preserve roads and occupied buildings and do not charge for them', () => {
  for (const kind of ['road', 'residential', 'power'] as const) {
    const city = ground();
    assert.ok(build(city, [point], kind).ok);
    const footprint = getFootprint(city, tileAt(city, point.x, point.z));
    const before = JSON.stringify(city);
    for (const tool of ['raise', 'lower', 'level'] as const) {
      assert.equal(build(city, footprint, tool, { targetElevation: 3 }).ok, false);
      assert.equal(JSON.stringify(city), before);
    }
  }
});

test('uneven large building footprints must be levelled before construction', () => {
  const city = ground(), points: Point[] = [];
  for (let z = 10; z < 16; z++) for (let x = 10; x < 20; x++) points.push({ x, z });
  tileAt(city, 15, 12).elevation = 3;
  const money = city.money;
  assert.equal(build(city, [{ x: 10, z: 10 }], 'airport').ok, false);
  assert.equal(city.money, money);
  assert.ok(build(city, points, 'level', { targetElevation: 1 }).ok);
  assert.ok(build(city, [{ x: 10, z: 10 }], 'airport').ok);
});

test('terrain limits and unaffordable earthworks do not alter the map or treasury', () => {
  const city = ground(), tile = tileAt(city, point.x, point.z);
  tile.elevation = MAX_ELEVATION;
  let before = JSON.stringify(city);
  assert.equal(build(city, [point], 'raise').ok, false); assert.equal(JSON.stringify(city), before);
  tile.elevation = MIN_ELEVATION; tile.kind = 'water';
  before = JSON.stringify(city);
  assert.equal(build(city, [point], 'lower').ok, false); assert.equal(JSON.stringify(city), before);
  tile.elevation = 1; tile.kind = 'empty'; city.money = 34;
  before = JSON.stringify(city);
  assert.equal(build(city, [point], 'raise').ok, false); assert.equal(JSON.stringify(city), before);
});

test('terraforming survives saves and bridge demolition uses modified terrain rather than the old coast', () => {
  const city = ground(), tile = tileAt(city, point.x, point.z);
  assert.ok(build(city, [point], 'level', { targetElevation: -1 }).ok);
  assert.equal(tile.kind, 'water'); assert.ok(build(city, [point], 'road').ok);
  const loaded = deserializeCity(serializeCity(city));
  assert.equal(tileAt(loaded, point.x, point.z).elevation, -1);
  assert.ok(build(loaded, [point], 'bulldoze').ok);
  assert.equal(tileAt(loaded, point.x, point.z).kind, 'water');
});
