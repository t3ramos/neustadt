import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tile } from '../../src/domain/types.ts';
import {
  generateNewYorkCity,
  generateSmallCity,
  parseCitySeed,
  starterPoint,
  DEFAULT_CITY_SIZE,
  MAX_NEW_CITY_SIZE,
  START_CITY_SIZE,
} from '../../src/world/scenarios.ts';
import {
  createCity,
  expandCity,
  build,
  deserializeCity,
  serializeCity,
  getFootprint,
  isBuildingAnchor,
  recalculate,
  tick,
  TOOL_DEFS,
} from '../../src/simulation/city-simulation.ts';
import { syncZoneLot } from '../../src/buildings/lots.ts';
const zones = ['residential', 'commercial', 'industrial'];

test('128-field seeded founding landscape is reproducible and reserves a broad clear valley', () => {
  assert.equal(DEFAULT_CITY_SIZE, 96);
  assert.equal(MAX_NEW_CITY_SIZE, 128);
  assert.equal(START_CITY_SIZE, 128);
  assert.equal(parseCitySeed('42'), 42);
  assert.equal(parseCitySeed(42), 42);
  assert.equal(parseCitySeed('-1'), 4294967295);
  assert.equal(parseCitySeed('  River City  '), parseCitySeed('River City'));
  assert.notEqual(parseCitySeed('River City'), parseCitySeed('River Town'));
  const a = generateSmallCity('Meine Insel', 'Test'),
    b = generateSmallCity('Meine Insel', 'Test'),
    c = generateSmallCity('Andere Insel');
  assert.deepEqual(a.tiles, b.tiles);
  assert.notDeepEqual(
    a.tiles.map((t) => t.elevation),
    c.tiles.map((t) => t.elevation),
  );
  assert.equal(a.size, 128);
  assert.ok(a.size >= 40 * 3, 'The founding map is at least triple the former side length');
  assert.equal(a.month, 0);
  assert.equal(a.speed, 0);
  assert.equal(a.stats.population, 0);
  assert.ok(
    a.tiles.every(
      (t) =>
        ['empty', 'tree', 'water'].includes(t.kind) &&
        !t.hasPipe &&
        !t.hasPowerLine &&
        t.anchor === -1,
    ),
  );
  const p = starterPoint();
  for (let z = p.z - 25; z <= p.z + 25; z++)
    for (let x = p.x - 25; x <= p.x + 25; x++) {
      const t: Tile = a.tiles[z * a.size + x];
      assert.equal(t.kind, 'empty');
      assert.equal(t.elevation, 0);
    }
  assert.equal(deserializeCity(serializeCity(a)).seed, a.seed);
});

test('New York round-trips complete parcels and supplies all buildings over a map-wide footprint', () => {
  const city = deserializeCity(serializeCity(generateNewYorkCity()));
  assert.equal(city.name, 'New York');
  assert.equal(city.size, 96);
  assert.equal(city.month, 0);
  assert.equal(city.speed, 0);
  assert.equal(city.progression.victory, false);
  assert.equal(city.progression.claimedQuests.length, 0);
  const buildings = city.tiles.filter(
    (t) => isBuildingAnchor(city, t) && (zones.includes(t.kind) || TOOL_DEFS[t.kind]?.footprint),
  );
  for (const t of buildings)
    assert.ok(t.connected && t.powered && t.watered, `${t.kind} ${t.x},${t.z} has full services`);
  const footprints = buildings.flatMap((t) => getFootprint(city, t));
  const width =
    Math.max(...footprints.map((p) => p.x)) - Math.min(...footprints.map((p) => p.x)) + 1;
  const depth =
    Math.max(...footprints.map((p) => p.z)) - Math.min(...footprints.map((p) => p.z)) + 1;
  assert.ok((width * depth) / city.size ** 2 > 0.8);
  const easterEgg = buildings.filter((t) => t.variation === 900005);
  assert.equal(easterEgg.length, 1);
  assert.equal(easterEgg[0].kind, 'commercial');
  assert.equal(getFootprint(city, easterEgg[0]).length, 6);
  assert.equal(easterEgg[0].rotation, 2);
  assert.equal(easterEgg[0].x, 34);
  assert.equal(easterEgg[0].z, 52);
  assert.equal(easterEgg[0].zoneDensity, 'medium');
  assert.equal(easterEgg[0].level, 2);
  assert.equal(city.tiles[51 * city.size + 34].kind, 'road');
  assert.equal(city.tiles[50 * city.size + 34].kind, 'park');
  for (const kind of zones) {
    const lots = buildings.filter((t) => t.kind === kind);
    assert.equal(new Set(lots.map((t) => t.variation % 5)).size, 5);
    for (const area of [2, 4, 6])
      assert.ok(
        lots.some((t) => getFootprint(city, t).length === area),
        `${kind}: ${area}-tile parcels`,
      );
  }
  assert.ok(city.stats.jobs / (city.stats.population * 0.48) > 0.8);
  assert.ok(city.stats.jobs / (city.stats.population * 0.48) < 1.3);
  // Test the worst utility load, independently of progression's current growth cap.
  for (const t of buildings)
    if (zones.includes(t.kind)) {
      t.level = 4;
      syncZoneLot(city, t);
    }
  recalculate(city);
  assert.ok(city.stats.powerSupply > city.stats.powerDemand);
  assert.ok(city.stats.waterSupply > city.stats.waterDemand);
  assert.ok(
    city.tiles
      .filter((t) => zones.includes(t.kind))
      .every((t) => t.connected && t.powered && t.watered),
  );
});

test('New York remains solvent, occupied and completely served after 12 and 120 economy steps (one and ten calendar months)', () => {
  const city = generateNewYorkCity(),
    initialPopulation = city.stats.population;
  for (let i = 1; i <= 120; i++) {
    tick(city);
    if (i !== 12 && i !== 120) continue;
    assert.ok(city.stats.population >= initialPopulation * 0.9);
    assert.ok(city.money > 0);
    assert.ok(city.stats.happiness > 55);
    assert.ok(city.stats.balance > 0);
    assert.ok(
      city.tiles
        .filter((t) => zones.includes(t.kind))
        .every((t) => t.connected && t.powered && t.watered),
    );
  }
  assert.equal(deserializeCity(serializeCity(city)).month, 120);
  assert.equal(
    city.tiles.filter((t) => isBuildingAnchor(city, t) && t.variation === 900005).length,
    1,
  );
});

test('New York reads as one street-aligned skyline, a midrise belt and low outer boroughs', () => {
  const city = generateNewYorkCity();
  const lots = city.tiles.filter((t) => zones.includes(t.kind) && isBuildingAnchor(city, t));
  const blocks = new Map<string, Set<string>>();
  for (const t of city.tiles.filter((t) => zones.includes(t.kind))) {
    const key = `${Math.floor((t.x - 4) / 6)},${Math.floor((t.z - 4) / 6)}`;
    const densities = blocks.get(key) ?? new Set<string>();
    densities.add(t.zoneDensity!);
    blocks.set(key, densities);
  }
  assert.ok(
    [...blocks.values()].every((densities) => densities.size === 1),
    'density changes align with streets, never split a neighborhood block',
  );
  for (const kind of zones)
    for (const density of ['low', 'medium', 'high'])
      assert.ok(
        lots.filter((t) => t.kind === kind && t.zoneDensity === density).length >= 10,
        `${kind} ${density} is a visible district, not a token parcel`,
      );
  const urban = lots.filter((t) => t.kind !== 'industrial');
  const high = urban.filter((t) => t.zoneDensity === 'high');
  assert.ok(high.length > 200);
  assert.ok(high.every((t) => t.x >= 22 && t.x < 58 && t.z >= 22 && t.z < 64 && t.level === 4));
  const middle = urban.filter((t) => t.zoneDensity === 'medium');
  assert.ok(middle.length > 200);
  assert.ok(middle.every((t) => t.level === 2));
  const outer = urban.filter((t) => t.x < 16 || t.z < 16 || t.z >= 76 || t.x >= 82);
  assert.ok(outer.length > 300);
  assert.ok(outer.every((t) => t.zoneDensity === 'low' && t.level === 1));
  assert.ok(city.stats.happiness >= 80);
  assert.ok(city.stats.balance > 0);
});

test('older saved city sizes stay intact and an explicit 40-to-128 expansion preserves player roads', () => {
  for (const size of [40, 64, 96, 128]) {
    const city = createCity(701, true, size);
    const loaded = deserializeCity(serializeCity(city));
    assert.equal(loaded.size, size);
    assert.deepEqual(
      loaded.tiles.map((t) => [t.kind, t.elevation]),
      city.tiles.map((t) => [t.kind, t.elevation]),
    );
  }
  const city = createCity(701, true, 40);
  const roads = [
    { x: 17, z: 18 },
    { x: 18, z: 18 },
    { x: 19, z: 18 },
  ];
  assert.ok(build(city, roads, 'road').ok);
  const before = serializeCity(city),
    larger = expandCity(city, 128);
  assert.equal(serializeCity(city), before, 'Explicit expansion never mutates the existing save');
  assert.equal(larger.size, 128);
  assert.equal(larger.money, city.money);
  for (const tile of city.tiles) {
    const retained: Tile = larger.tiles[tile.z * larger.size + tile.x];
    assert.equal(retained.kind, tile.kind);
    assert.equal(retained.elevation, tile.elevation);
    assert.equal(retained.hasPipe, tile.hasPipe);
    assert.equal(retained.hasPowerLine, tile.hasPowerLine);
  }
  for (const { x, z } of roads) assert.equal(larger.tiles[z * larger.size + x].kind, 'road');
  for (let z = 42; z < 84; z++)
    for (let x = 42; x < 84; x++) {
      const addition: Tile = larger.tiles[z * larger.size + x];
      assert.equal(
        addition.elevation,
        0,
        'Modern expansion retains the broad new valley instead of importing the legacy estuary',
      );
      assert.equal(addition.kind, 'empty');
    }
});
