import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOOL_DEFS,
  applyCitizenIncident,
  build,
  createCity,
  deserializeCity,
  expandCity,
  getFootprint,
  isBuildingAnchor,
  previewBuild,
  recalculate,
  repayLoan,
  serializeCity,
  takeLoan,
  tick,
  triggerDisaster,
} from '../../src/simulation/city-simulation.ts';
import {
  getLocale,
  localizedEventMessage,
  localizedEventTitle,
  setLocale,
} from '../../src/i18n/index.ts';
import type { CitizenIncident, CityState, Point, Tile, Tool } from '../../src/domain/types.ts';
import { getTerrainElevation, legacyWaterTerrain } from '../../src/world/terrain.ts';

const tileAt = (city: CityState, x: number, z: number): Tile => {
  const tile = city.tiles[z * city.size + x];
  assert.ok(tile && tile.x === x && tile.z === z, `Expected a tile at ${x},${z}`);
  return tile;
};
const line = (x1: number, z1: number, x2: number, z2: number): Point[] => {
  const points: Point[] = [];
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) points.push({ x, z });
  return points;
};
const unlock = (city: CityState, ...tools: Tool[]) => {
  for (const tool of tools)
    if (!city.progression.unlocked.includes(tool)) city.progression.unlocked.push(tool);
};
const construct = (city: CityState, points: Point | Point[], tool: Tool) => {
  unlock(city, tool);
  const result = build(city, Array.isArray(points) ? points : [points], tool);
  assert.ok(result.ok, `${tool} construction failed: ${result.message}`);
  return result;
};
/** Flat vacant ground isolates economy/network assertions from coastline and terrain generation. */
const flatCity = (seed = 55): CityState => {
  const city = createCity(seed, true, 40);
  for (const tile of city.tiles) {
    tile.kind = 'empty';
    tile.level = 0;
    tile.elevation = 1;
    tile.anchor = -1;
    tile.hasPipe = false;
    tile.hasPowerLine = false;
  }
  recalculate(city);
  return city;
};
const district = (zones = true): CityState => {
  const city = flatCity();
  construct(city, { x: 3, z: 3 }, 'power');
  construct(city, { x: 10, z: 3 }, 'waterpump');
  const roads = [...line(3, 8, 30, 8), ...line(4, 7, 4, 8), ...line(10, 5, 10, 8)];
  construct(city, roads, 'road');
  const network = [...line(4, 6, 4, 8), ...line(10, 4, 10, 8), ...line(3, 8, 30, 8)];
  construct(city, network, 'powerline');
  construct(city, network, 'pipe');
  if (zones) {
    for (const [x, kind, level] of [
      [15, 'residential', 3],
      [17, 'commercial', 1],
      [19, 'industrial', 1],
    ] as const) {
      construct(city, { x, z: 9 }, kind);
      tileAt(city, x, 9).level = level;
    }
  }
  recalculate(city);
  return city;
};

test('default generation is deterministic, ten times the old area, and starts with a viable city', () => {
  const first = createCity(7813),
    second = createCity(7813);
  assert.equal(first.version, 2);
  assert.equal(first.size, 128);
  assert.equal(first.tiles.length, 128 ** 2);
  assert.ok(first.tiles.length >= 10 * 40 ** 2);
  assert.equal(new Set(first.tiles.map((tile) => `${tile.x},${tile.z}`)).size, first.size ** 2);
  assert.deepEqual(first.tiles, second.tiles);
  assert.ok(first.tiles.some((tile) => tile.kind === 'water'));
  assert.ok(
    new Set(first.tiles.map((tile) => tile.elevation)).size > 4,
    'Terrain needs actual elevation differences',
  );
  assert.ok(first.stats.population > 500);
  assert.ok(first.stats.balance > 0, 'The starter city should have a positive monthly budget');
  assert.ok(
    first.tiles.some(
      (tile) => tile.kind === 'residential' && tile.connected && tile.powered && tile.watered,
    ),
  );
});

test('supported map sizes contain exactly one correctly indexed tile per coordinate', () => {
  for (const size of [40, 64, 96, 128]) {
    const city = createCity(17, true, size);
    assert.equal(city.size, size);
    assert.equal(city.tiles.length, size ** 2);
    city.tiles.forEach((tile, i) => {
      assert.equal(tile.x, i % size);
      assert.equal(tile.z, Math.floor(i / size));
      assert.ok(Number.isFinite(tile.elevation));
    });
  }
});

test('construction deduplicates painted tiles and never charges twice for an existing road', () => {
  const city = flatCity(),
    point = { x: 10, z: 10 },
    money = city.money;
  const result = construct(city, [point, point], 'road');
  assert.equal(result.count, 1);
  assert.equal(result.cost, TOOL_DEFS.road!.cost);
  assert.equal(city.money, money - result.cost);
  assert.equal(tileAt(city, 10, 10).kind, 'road');
  const paid = city.money;
  assert.equal(build(city, [point], 'road').ok, false);
  assert.equal(city.money, paid);
});

test('preview gives the exact build price and footprint without mutating any city state', () => {
  const city = flatCity();
  unlock(city, 'stadium');
  const before = JSON.stringify(city);
  const points = [
    { x: 10, z: 10 },
    { x: 25, z: 25 },
  ];
  const preview = previewBuild(city, points, 'stadium');
  assert.equal(JSON.stringify(city), before);
  assert.equal(preview.invalid.length, 0);
  assert.equal(preview.valid.length, 30);
  assert.equal(preview.cost, TOOL_DEFS.stadium!.cost);
  const result = build(city, points, 'stadium');
  assert.ok(result.ok, result.message);
  assert.equal(result.cost, preview.cost);
  assert.equal(result.count, preview.count);
  assert.equal(
    tileAt(city, 25, 25).kind,
    'empty',
    'A landmark is a single placement, never a paintbrush',
  );
});

test('large civic buildings occupy one atomic footprint with one charge and one operating bill', () => {
  for (const [kind, area] of [
    ['power', 16],
    ['police', 4],
    ['fire', 6],
    ['hospital', 9],
    ['school', 6],
    ['university', 20],
    ['stadium', 30],
    ['airport', 60],
  ] as const) {
    const city = flatCity();
    const expenses = city.stats.expenses;
    const result = construct(city, { x: 10, z: 10 }, kind);
    const anchor = tileAt(city, 10, 10);
    assert.equal(result.cost, TOOL_DEFS[kind]!.cost, `${kind} price must be charged once`);
    assert.equal(getFootprint(city, anchor).length, area);
    const members = city.tiles.filter((tile) => tile.kind === kind);
    assert.equal(members.length, area);
    assert.equal(members.filter((tile) => isBuildingAnchor(city, tile)).length, 1);
    for (const member of members)
      assert.deepEqual(getFootprint(city, member), getFootprint(city, anchor));
    assert.equal(city.stats.expenses - expenses, Math.ceil(TOOL_DEFS[kind]!.upkeep));
  }
});

test('a landmark rotates its footprint and cannot overlap existing construction or the map boundary', () => {
  const city = flatCity();
  unlock(city, 'airport');
  construct(city, { x: 15, z: 15 }, 'road');
  for (const points of [[{ x: 10, z: 10 }], [{ x: 36, z: 35 }]]) {
    const before = JSON.stringify(city);
    const result = build(city, points, 'airport');
    assert.equal(result.ok, false);
    assert.equal(
      JSON.stringify(city),
      before,
      'Rejected atomic placement must leave every field untouched',
    );
  }
  const result = build(city, [{ x: 25, z: 15 }], 'airport', { rotation: 1 });
  assert.ok(result.ok, result.message);
  const footprint = getFootprint(city, tileAt(city, 25, 15));
  assert.equal(Math.max(...footprint.map((p) => p.x)) - 25 + 1, 6);
  assert.equal(Math.max(...footprint.map((p) => p.z)) - 15 + 1, 10);
});

test('demolishing any occupied landmark cell removes the complete building and charges once', () => {
  const city = flatCity();
  construct(city, { x: 10, z: 10 }, 'stadium');
  const money = city.money;
  const result = construct(
    city,
    [
      { x: 15, z: 14 },
      { x: 10, z: 10 },
    ],
    'bulldoze',
  );
  assert.equal(
    city.tiles.some((tile) => tile.kind === 'stadium'),
    false,
  );
  assert.equal(city.money, money - result.cost);
  assert.equal(result.cost, 25, 'One building must not be charged per occupied cell');
  for (const point of line(10, 10, 15, 14)) {
    const tile = tileAt(city, point.x, point.z);
    assert.equal(tile.kind, 'empty');
    assert.equal(tile.anchor, -1);
  }
});

test('unaffordable, out-of-map and underwater construction does not spend money or change land', () => {
  const city = createCity(123, true, 40);
  const point = { x: 10, z: 10 };
  city.money = TOOL_DEFS.power!.cost - 1;
  const before = JSON.stringify(city);
  assert.equal(build(city, [point], 'power').ok, false);
  assert.equal(JSON.stringify(city), before);
  assert.equal(
    build(
      city,
      [
        { x: -1, z: 10 },
        { x: city.size, z: 10 },
      ],
      'road',
    ).ok,
    false,
  );
  assert.equal(JSON.stringify(city), before);
  const water = city.tiles.find((tile) => tile.kind === 'water')!;
  assert.ok(water);
  assert.equal(build(city, [water], 'residential').ok, false);
  assert.equal(JSON.stringify(city), before);
});

test('roads carry traffic access while independent power and pipe networks deliver utilities', () => {
  const city = district(false);
  construct(city, { x: 15, z: 9 }, 'residential');
  construct(city, { x: 25, z: 22 }, 'residential');
  const connected = tileAt(city, 15, 9),
    isolated = tileAt(city, 25, 22);
  assert.equal(connected.connected, true);
  assert.equal(connected.powered, true);
  assert.equal(connected.watered, true);
  assert.equal(isolated.connected, false);
  assert.equal(isolated.powered, false);
  assert.equal(isolated.watered, false);
  for (let month = 0; month < 48; month++) tick(city);
  assert.equal(city.month, 48);
  assert.equal(isolated.level, 0);
  assert.ok(connected.level > 0);
  assert.ok(city.stats.population > 0);
  assert.ok(Object.values(city.stats).every(Number.isFinite));
});

test('a road without a utility layer does not magically supply a distant building', () => {
  const city = district(false);
  for (const tile of city.tiles) {
    tile.hasPipe = false;
    tile.hasPowerLine = false;
  }
  construct(city, { x: 20, z: 9 }, 'residential');
  const home = tileAt(city, 20, 9);
  assert.equal(home.connected, true);
  assert.equal(home.powered, false);
  assert.equal(home.watered, false);
});

test('one edge feed supplies a whole contiguous mixed zone block, including vacant lots', () => {
  const city = flatCity();
  construct(city, { x: 3, z: 3 }, 'power');
  construct(city, line(8, 6, 20, 6), 'residential');
  construct(city, line(8, 7, 20, 7), 'commercial');
  construct(city, line(8, 8, 20, 8), 'industrial');
  assert.equal(
    tileAt(city, 20, 8).powered,
    false,
    'An isolated block still needs a grid connection',
  );
  construct(city, { x: 7, z: 6 }, 'powerline');
  for (const point of line(8, 6, 20, 8)) assert.equal(tileAt(city, point.x, point.z).powered, true);
  assert.equal(
    city.tiles.filter((tile) => tile.hasPowerLine).length,
    1,
    'A block needs one feed, not one wire per lot',
  );
  for (let x = 8; x <= 20; x++) tileAt(city, x, 6).level = 4;
  recalculate(city);
  assert.equal(tileAt(city, 20, 6).powered, true);
  construct(city, { x: 7, z: 6 }, 'bulldoze');
  assert.equal(tileAt(city, 20, 6).powered, false, 'Removing the sole block feed disconnects it');
});

test('unwired roads separate blocks while an explicit power crossing supplies the far block', () => {
  const city = flatCity();
  construct(city, { x: 3, z: 3 }, 'power');
  construct(city, line(7, 6, 10, 6), 'residential');
  construct(city, line(11, 2, 11, 10), 'road');
  construct(city, line(12, 6, 16, 6), 'residential');
  assert.equal(tileAt(city, 10, 6).powered, true);
  assert.equal(
    tileAt(city, 12, 6).powered,
    false,
    'Electricity must not jump across asphalt by proximity',
  );
  assert.equal(tileAt(city, 16, 6).powered, false);
  construct(city, { x: 11, z: 6 }, 'powerline');
  assert.equal(
    tileAt(city, 16, 6).powered,
    true,
    'A deliberately built crossing is valid infrastructure',
  );
  construct(city, { x: 11, z: 6 }, 'bulldoze');
  assert.equal(tileAt(city, 12, 6).powered, false, 'Nor can power jump a vacant gap');
});

test('a large facility retains a legal short service drop but cannot draw a drop across a road', () => {
  const city = flatCity();
  construct(city, { x: 3, z: 3 }, 'power');
  construct(city, line(7, 6, 15, 6), 'powerline');
  construct(city, { x: 12, z: 8 }, 'police');
  assert.equal(
    tileAt(city, 12, 8).powered,
    true,
    'A clear one-tile gap is a legitimate facility service',
  );
  construct(city, line(9, 7, 17, 7), 'road');
  assert.equal(tileAt(city, 12, 8).powered, false, 'A service drop may not cross the new street');
  construct(city, { x: 12, z: 7 }, 'powerline');
  assert.equal(
    tileAt(city, 12, 8).powered,
    true,
    'Building the trunk across the street connects the facility',
  );
});

test('a large facility service feed supplies its entire touching zone block', () => {
  const city = flatCity();
  construct(city, { x: 2, z: 8 }, 'wind');
  construct(city, line(4, 8, 10, 8), 'powerline');
  construct(city, { x: 12, z: 8 }, 'police');
  construct(city, line(14, 8, 19, 8), 'residential');
  assert.equal(
    tileAt(city, 12, 8).powered,
    true,
    'The facility has a legal service over the free gap',
  );
  assert.equal(
    tileAt(city, 19, 8).powered,
    true,
    'That service feeds the connected block, not just the facility',
  );
  assert.equal(
    city.stats.powerSupply,
    1200,
    'A service extends the grid without adding generator capacity',
  );
  construct(city, { x: 9, z: 8 }, 'bulldoze');
  assert.equal(tileAt(city, 12, 8).powered, false);
  assert.equal(tileAt(city, 19, 8).powered, false);
});

test('one edge feed powers isolated lots inside a closed city block without supplying the next block or wilderness', () => {
  const city = flatCity();
  construct(city, { x: 2, z: 9 }, 'power');
  construct(
    city,
    [
      ...line(8, 8, 18, 8),
      ...line(8, 13, 18, 13),
      ...line(8, 9, 8, 12),
      ...line(13, 9, 13, 12),
      ...line(18, 9, 18, 12),
    ],
    'road',
  );
  construct(
    city,
    [
      { x: 10, z: 9 },
      { x: 12, z: 12 },
    ],
    'residential',
  );
  construct(city, { x: 9, z: 11 }, 'commercial');
  construct(city, { x: 16, z: 11 }, 'residential');
  construct(city, { x: 30, z: 25 }, 'residential');
  construct(
    city,
    [
      { x: 10, z: 10 },
      { x: 11, z: 11 },
    ],
    'tree',
  );
  const cityLayout = city.tiles.map((tile) => [tile.kind, tile.level]);
  construct(city, line(6, 10, 8, 10), 'powerline');
  for (const [x, z] of [
    [10, 9],
    [12, 12],
    [9, 11],
  ])
    assert.equal(
      tileAt(city, x, z).powered,
      true,
      'Gardens and vacant lots remain part of their enclosed block',
    );
  assert.equal(
    tileAt(city, 16, 11).powered,
    false,
    'The intervening street keeps separate blocks electrically separate',
  );
  assert.equal(
    tileAt(city, 30, 25).powered,
    false,
    'Open countryside does not become one enormous powered block',
  );
  assert.equal(
    city.tiles.filter((tile) => tile.hasPowerLine).length,
    3,
    'No hidden migration or per-lot overhead lines are added',
  );
  assert.deepEqual(
    city.tiles.map((tile) => [tile.kind, tile.level]),
    cityLayout,
  );
  const loaded = deserializeCity(serializeCity(city));
  assert.equal(tileAt(loaded, 12, 12).powered, true);
  assert.equal(tileAt(loaded, 16, 11).powered, false);
  construct(city, { x: 13, z: 11 }, 'powerline');
  assert.equal(
    tileAt(city, 16, 11).powered,
    true,
    'An explicit street crossing feeds the neighboring block',
  );
});

test('pipes and power lines coexist with streets and buildings without replacing their surface', () => {
  const city = flatCity();
  construct(city, { x: 10, z: 10 }, 'road');
  construct(city, { x: 11, z: 10 }, 'residential');
  const points = [
    { x: 10, z: 10 },
    { x: 11, z: 10 },
  ];
  construct(city, points, 'pipe');
  construct(city, points, 'powerline');
  assert.equal(tileAt(city, 10, 10).kind, 'road');
  assert.equal(tileAt(city, 11, 10).kind, 'residential');
  for (const point of points) {
    const tile = tileAt(city, point.x, point.z);
    assert.equal(tile.hasPipe, true);
    assert.equal(tile.hasPowerLine, true);
  }
  const money = city.money;
  assert.equal(build(city, points, 'pipe').ok, false);
  assert.equal(build(city, points, 'powerline').ok, false);
  assert.equal(city.money, money);
});

test('severing water supply leaves electricity intact; severing electricity shuts down the water pump', () => {
  const city = district();
  const home = tileAt(city, 15, 9);
  assert.equal(home.watered, true);
  tileAt(city, 11, 8).hasPipe = false;
  recalculate(city);
  assert.equal(home.watered, false);
  assert.equal(home.powered, true);
  tileAt(city, 11, 8).hasPipe = true;
  tileAt(city, 7, 8).hasPowerLine = false;
  recalculate(city);
  assert.equal(tileAt(city, 10, 3).powered, false);
  assert.equal(city.stats.waterSupply, 0);
  assert.equal(home.watered, false);
});

test('bulldozing the sole utility route disconnects service beyond the gap and clears both layers', () => {
  const city = district();
  const home = tileAt(city, 15, 9);
  assert.equal(home.powered, true);
  assert.equal(home.watered, true);
  construct(city, { x: 11, z: 8 }, 'bulldoze');
  const gap = tileAt(city, 11, 8);
  assert.equal(gap.hasPipe, false);
  assert.equal(gap.hasPowerLine, false);
  assert.equal(home.powered, false);
  assert.equal(home.watered, false);
});

test('road and railway bridges preserve their water elevation across save and demolition', () => {
  for (const tool of ['road', 'rail'] as const) {
    const city = createCity(55, true, 40);
    unlock(city, tool);
    const water = city.tiles.find((tile) => tile.kind === 'water')!;
    const point = { x: water.x, z: water.z },
      elevation = water.elevation,
      money = city.money;
    const bridge = construct(city, point, tool);
    assert.ok(bridge.cost > TOOL_DEFS[tool]!.cost);
    const loaded = deserializeCity(serializeCity(city));
    assert.equal(tileAt(loaded, point.x, point.z).kind, tool);
    const demolition = construct(loaded, point, 'bulldoze');
    assert.equal(tileAt(loaded, point.x, point.z).kind, 'water');
    assert.equal(tileAt(loaded, point.x, point.z).elevation, elevation);
    assert.equal(loaded.money, money - bridge.cost - demolition.cost);
  }
});

test('bridge rubble retains water rules and can be rebuilt into a loadable bridge', () => {
  const city = createCity(55, true, 40),
    water = city.tiles.find((tile) => tile.kind === 'water')!;
  construct(city, water, 'road');
  water.kind = 'rubble';
  recalculate(city);
  const money = city.money;
  assert.equal(build(city, [water], 'residential').ok, false);
  assert.equal(city.money, money);
  const repair = construct(city, water, 'road');
  assert.equal(repair.cost, TOOL_DEFS.road!.cost + 90);
  assert.equal(tileAt(deserializeCity(serializeCity(city)), water.x, water.z).kind, 'road');
});

test('service funding changes operating costs and resident outcomes and can be restored', () => {
  const city = createCity(438, false, 40),
    funded = { ...city.stats };
  city.funding = { police: 0, fire: 0, health: 0, education: 0 };
  recalculate(city);
  assert.ok(city.stats.expenses < funded.expenses);
  assert.ok(city.stats.education < funded.education);
  assert.ok(city.stats.health < funded.health);
  assert.ok(city.stats.safety < funded.safety);
  city.funding = { police: 100, fire: 100, health: 100, education: 100 };
  recalculate(city);
  assert.deepEqual(city.stats, funded);
});

test('a burning power station supplies no electricity and an unpowered pump supplies no water', () => {
  const city = district();
  assert.ok(city.stats.powerSupply > 0);
  assert.ok(city.stats.waterSupply > 0);
  tileAt(city, 3, 3).fire = 6;
  recalculate(city);
  assert.equal(city.stats.powerSupply, 0);
  assert.equal(tileAt(city, 10, 3).powered, false);
  assert.equal(city.stats.waterSupply, 0);
  assert.equal(
    city.tiles.some((tile) => tile.watered),
    false,
  );
});

test('an overloaded grid can leave its pump without electricity and therefore supplies no water', () => {
  const city = district();
  for (const tile of city.tiles)
    if (tile.kind === 'empty') {
      tile.kind = 'industrial';
      tile.level = 3;
    }
  recalculate(city);
  assert.ok(city.stats.powerDemand > city.stats.powerSupply);
  assert.equal(city.stats.powerSupply, 6000, 'The plant footprint must contribute capacity once');
  assert.equal(tileAt(city, 10, 3).powered, false);
  assert.equal(city.stats.waterSupply, 0);
  assert.ok(city.tiles.some((tile) => tile.kind === 'industrial' && tile.powered));
  assert.equal(
    city.tiles.some((tile) => tile.watered),
    false,
  );
});

test('save and load preserve deterministic growth and disaster continuation including v2 fields', () => {
  const city = createCity(438, false, 40);
  city.name = 'Hafenstadt';
  city.tax = 11;
  city.settings.disastersEnabled = true;
  city.settings.weather = 'rain';
  for (let i = 0; i < 8; i++) tick(city);
  const loaded = deserializeCity(serializeCity(city));
  for (const key of ['name', 'seed', 'month', 'money', 'tax', 'revision'] as const)
    assert.equal(loaded[key], city[key]);
  assert.deepEqual(loaded.tiles, city.tiles);
  assert.deepEqual(loaded.settings, city.settings);
  assert.deepEqual(loaded.progression, city.progression);
  for (let i = 0; i < 12; i++) {
    tick(city);
    tick(loaded);
  }
  assert.deepEqual(loaded.tiles, city.tiles);
  assert.deepEqual(loaded.stats, city.stats);
  assert.equal(loaded.money, city.money);
  triggerDisaster(city, 'fire');
  triggerDisaster(loaded, 'fire');
  assert.deepEqual(loaded.tiles, city.tiles);
});

test('loading rejects corrupted files, invalid economy, terrain and broken building ownership', () => {
  for (const raw of ['not json', '{}', 'null']) assert.throws(() => deserializeCity(raw));
  const saved = serializeCity(createCity(438, false, 40));
  const corruptions: ((raw: any) => void)[] = [
    (raw) => {
      raw.version = 999;
    },
    (raw) => {
      raw.tiles.pop();
    },
    (raw) => {
      raw.tiles[0].kind = 'unrecognized-building';
    },
    (raw) => {
      raw.money = 'unlimited';
    },
    (raw) => {
      raw.tiles[0].x = -1;
    },
    (raw) => {
      raw.tiles[0].elevation = 999;
    },
    (raw) => {
      raw.tiles[0].hasPipe = 'yes';
    },
    (raw) => {
      raw.tiles[0].anchor = raw.tiles.length + 1;
    },
    (raw) => {
      raw.settings.disastersEnabled = 'true';
    },
  ];
  for (const corrupt of corruptions) {
    const raw = JSON.parse(saved);
    corrupt(raw);
    assert.throws(() => deserializeCity(JSON.stringify(raw)), `Must reject ${corrupt.toString()}`);
  }
});

test('loans enforce the credit limit and repayment cannot overdraw the treasury', () => {
  const city = flatCity(91),
    money = city.money;
  for (let i = 0; i < 5; i++) assert.ok(takeLoan(city).ok);
  assert.equal(city.loan, 50_000);
  assert.equal(city.money, money + 50_000);
  assert.equal(takeLoan(city).ok, false);
  assert.equal(city.money, money + 50_000);
  city.money = 9_999;
  assert.equal(repayLoan(city).ok, false);
  assert.equal(city.money, 9_999);
  assert.equal(city.loan, 50_000);
  city.money = 10_000;
  assert.ok(repayLoan(city).ok);
  assert.equal(city.money, 0);
  assert.equal(city.loan, 40_000);
  assert.equal(repayLoan(city).ok, false);
  assert.equal(city.money, 0);
});

test('monthly accounting charges interest and records the resulting treasury in history', () => {
  const city = flatCity(91),
    expenses = city.stats.expenses;
  assert.ok(takeLoan(city).ok);
  assert.equal(city.stats.expenses - expenses, 50);
  const money = city.money,
    balance = city.stats.balance;
  tick(city);
  assert.equal(city.month, 1);
  assert.equal(city.money, money + balance);
  assert.ok(city.history.some((point) => point.month === city.month && point.money === city.money));
});

test('manual disasters are gated by the setting and each enabled disaster causes real damage', () => {
  for (const kind of ['fire', 'earthquake', 'storm'] as const) {
    const city = createCity(834, false, 40);
    assert.equal(city.settings.disastersEnabled, false);
    const before = JSON.stringify(city.tiles),
      month = city.month;
    triggerDisaster(city, kind);
    assert.equal(
      JSON.stringify(city.tiles),
      before,
      `${kind} must not cause damage while disabled`,
    );
    city.settings.disastersEnabled = true;
    triggerDisaster(city, kind);
    assert.notEqual(JSON.stringify(city.tiles), before, `${kind} must affect actual city tiles`);
    assert.ok(
      city.tiles.some((tile) => tile.fire > 0 || tile.kind === 'rubble'),
      `${kind} needs visible damage`,
    );
    assert.equal(city.month, month);
    assert.ok(city.events.some((event) => event.type === 'warning'));
    assert.doesNotThrow(() => deserializeCity(serializeCity(city)));
  }
});

test('landmarks add jobs and demand only once and cease operation when their power plant is removed', () => {
  for (const [kind, jobs, demand] of [
    ['stadium', 120, 'residentialDemand'],
    ['airport', 180, 'commercialDemand'],
    ['seaport', 120, 'industrialDemand'],
  ] as const) {
    const city = district();
    if (kind === 'seaport')
      for (const tile of city.tiles)
        if (tile.z >= 12) {
          tile.kind = 'water';
          tile.elevation = -1;
        }
    const before = { ...city.stats };
    construct(city, { x: 22, z: 9 }, kind);
    assert.equal(city.stats.jobs, before.jobs + jobs, `${kind} jobs should count one anchor`);
    assert.ok(city.stats[demand] > before[demand], `${kind} should create demand`);
    assert.ok(city.stats.expenses > before.expenses);
    construct(city, { x: 3, z: 3 }, 'bulldoze');
    assert.equal(city.stats.jobs, before.jobs, `${kind} cannot operate without electricity`);
  }
  const inland = district();
  unlock(inland, 'seaport');
  const money = inland.money;
  assert.equal(build(inland, [{ x: 22, z: 9 }], 'seaport').ok, false);
  assert.equal(inland.money, money);
});

test('rail reduces traffic while parks and trees reduce pollution and improve local land value', () => {
  const city = district(),
    home = tileAt(city, 15, 9),
    traffic = home.traffic;
  construct(city, line(15, 10, 17, 10), 'rail');
  assert.ok(home.traffic < traffic);
  const pollution = home.pollution,
    value = home.landValue;
  construct(city, { x: 15, z: 7 }, 'park');
  assert.ok(home.pollution < pollution);
  assert.ok(home.landValue > value);
  const greener = home.pollution;
  construct(
    city,
    [
      { x: 16, z: 7 },
      { x: 14, z: 7 },
    ],
    'tree',
  );
  assert.ok(home.pollution < greener);
});

test('funded operational fire stations suppress nearby fire but cannot protect themselves while burning', () => {
  const protectedCity = district();
  construct(protectedCity, { x: 12, z: 9 }, 'fire');
  const home = tileAt(protectedCity, 15, 9);
  home.fire = 6;
  tick(protectedCity);
  assert.ok(home.fire <= 2, 'Operational fire crew should rapidly reduce fire duration');
  tick(protectedCity);
  assert.equal(home.fire, 0);
  assert.equal(home.kind, 'residential');
  const burningCity = district();
  construct(burningCity, { x: 12, z: 9 }, 'fire');
  const station = tileAt(burningCity, 12, 9);
  station.fire = 6;
  tick(burningCity);
  assert.equal(station.fire, 5);
});

test('fire cannot spread into a zoned lot before a building has developed', () => {
  const city = flatCity(3);
  construct(
    city,
    [
      { x: 10, z: 10 },
      { x: 11, z: 10 },
    ],
    'residential',
  );
  tileAt(city, 10, 10).level = 1;
  tileAt(city, 10, 10).fire = 6;
  const vacant = tileAt(city, 11, 10);
  for (let month = 0; month < 6; month++) tick(city);
  assert.equal(vacant.kind, 'residential');
  assert.equal(vacant.level, 0);
  assert.equal(vacant.fire, 0);
});

test('housing requires employment beyond the founding village', () => {
  const city = district(false);
  construct(city, line(10, 9, 24, 9), 'residential');
  for (let month = 0; month < 120; month++) tick(city);
  assert.equal(city.stats.jobs, 0);
  assert.ok(city.stats.population > 0);
  assert.ok(city.stats.population <= 220, 'Housing alone cannot sustain unlimited growth');
  const demand = city.stats.residentialDemand;
  construct(city, line(19, 7, 21, 7), 'industrial');
  for (const x of [19, 20, 21]) tileAt(city, x, 7).level = 2;
  recalculate(city);
  assert.ok(city.stats.residentialDemand > demand);
});

test('a mixed district can grow from initial funds without loans and reach a sustainable budget', () => {
  const city = district(false);
  const roads = [...line(10, 14, 27, 14), ...line(10, 20, 27, 20), ...line(10, 8, 10, 20)];
  construct(city, roads, 'road');
  construct(city, roads, 'pipe');
  construct(city, roads, 'powerline');
  for (let x = 11; x <= 27; x++) {
    construct(
      city,
      [
        { x, z: 9 },
        { x, z: 13 },
      ],
      'residential',
    );
    construct(city, { x, z: 15 }, 'commercial');
    construct(city, { x, z: 19 }, 'industrial');
  }
  let lowest = city.money;
  for (let month = 0; month < 72; month++) {
    tick(city);
    lowest = Math.min(lowest, city.money);
  }
  assert.ok(lowest > 0);
  assert.ok(city.stats.population >= 500);
  assert.ok(city.stats.jobs > 0);
  assert.ok(city.stats.balance > 0);
  assert.equal(city.loan, 0);
});

test('expanding a legacy-sized city preserves residents, economy, calendar and original coordinates', () => {
  const city = createCity(602, false, 40);
  // Historical 40-tile worlds used a fixed coastline and a uniform -1 seabed.
  // Reconstruct it explicitly rather than relabelling a modern mountain map as legacy.
  for (const tile of city.tiles) {
    const water = legacyWaterTerrain(tile.x, tile.z);
    tile.elevation = water ? -1 : 0;
    if (water) tile.kind = 'water';
    else if (tile.kind === 'water') tile.kind = 'empty';
  }
  for (let i = 0; i < 3; i++) tick(city);
  const residents = city.tiles
    .filter((tile) => tile.kind === 'residential')
    .map((tile) => ({ x: tile.x, z: tile.z, level: tile.level }));
  const saved = {
    money: city.money,
    month: city.month,
    seed: city.seed,
    population: city.stats.population,
  };
  const larger = expandCity(city, 128);
  assert.equal(larger.size, 128);
  assert.equal(larger.tiles.length, 128 ** 2);
  assert.equal(larger.money, saved.money);
  assert.equal(larger.month, saved.month);
  assert.equal(larger.seed, saved.seed);
  assert.equal(larger.stats.population, saved.population);
  for (let i = 0; i < 40; i++) {
    assert.equal(
      tileAt(larger, i, 40).elevation,
      tileAt(larger, i, 39).elevation,
      'The south edge continues at the saved height',
    );
    assert.equal(
      tileAt(larger, 40, i).elevation,
      tileAt(larger, 39, i).elevation,
      'The east coast continues without a boundary step',
    );
  }
  // Beyond the preserved legacy coastline transition, expansion uses the seeded generator.
  for (const [x, z] of [
    [80, 80],
    [100, 90],
    [127, 100],
  ]) {
    assert.equal(tileAt(larger, x, z).elevation, getTerrainElevation(x, z, 128, saved.seed));
  }
  for (const home of residents) {
    const tile = tileAt(larger, home.x, home.z);
    assert.equal(tile.kind, 'residential');
    assert.equal(tile.level, home.level);
  }
  assert.doesNotThrow(() => deserializeCity(serializeCity(larger)));
});

test('version-one saves migrate single-cell facilities without destroying existing homes', () => {
  const legacy: any = JSON.parse(JSON.stringify(createCity(602, true, 40)));
  legacy.version = 1;
  delete legacy.progression;
  delete legacy.settings;
  delete legacy.citizenEffects;
  for (const tile of legacy.tiles) {
    // Version one inferred heights from this exact coastline; deleting height fields
    // from a newly generated map alone does not produce a valid historical save.
    tile.kind = legacyWaterTerrain(tile.x, tile.z) ? 'water' : 'empty';
    tile.level = 0;
    delete tile.elevation;
    delete tile.hasPipe;
    delete tile.hasPowerLine;
    delete tile.anchor;
    delete tile.rotation;
  }
  for (const [x, z, kind, level] of [
    [15, 14, 'residential', 3],
    [16, 14, 'residential', 2],
    [19, 19, 'police', 1],
    [27, 27, 'power', 1],
    [29, 18, 'waterpump', 1],
  ] as const) {
    Object.assign(legacy.tiles[z * 40 + x], { kind, level });
  }
  const loaded = deserializeCity(JSON.stringify(legacy));
  assert.equal(loaded.version, 2);
  assert.equal(loaded.size, 40);
  assert.equal(loaded.money, legacy.money);
  assert.deepEqual(loaded.citizenEffects, {
    populationLoss: 0,
    happinessPenalty: 0,
    incidents: [],
  });
  assert.equal(loaded.settings.dayNightCycle, true);
  assert.equal(loaded.settings.timeOfDay, 14);
  assert.equal(tileAt(loaded, 15, 14).kind, 'residential');
  assert.equal(tileAt(loaded, 15, 14).level, 3);
  assert.equal(tileAt(loaded, 16, 14).kind, 'residential');
  assert.equal(tileAt(loaded, 16, 14).level, 2);
  for (const kind of ['police', 'power', 'waterpump'] as const) {
    const anchors = loaded.tiles.filter(
      (tile) => tile.kind === kind && isBuildingAnchor(loaded, tile),
    );
    assert.equal(anchors.length, 1);
    assert.equal(
      getFootprint(loaded, anchors[0]).length,
      1,
      'Import first preserves the old map exactly',
    );
  }
  assert.doesNotThrow(() => deserializeCity(serializeCity(loaded)));
  const original = JSON.stringify(loaded),
    expanded = expandCity(loaded, 128);
  assert.equal(
    JSON.stringify(loaded),
    original,
    'Expansion returns a new city rather than modifying the saved original',
  );
  assert.equal(expanded.money, loaded.money);
  assert.equal(expanded.stats.population, loaded.stats.population);
  for (const [x, level] of [
    [15, 3],
    [16, 2],
  ]) {
    assert.equal(tileAt(expanded, x, 14).kind, 'residential');
    assert.equal(tileAt(expanded, x, 14).level, level);
  }
  for (const kind of ['police', 'power', 'waterpump'] as const) {
    const anchors = expanded.tiles.filter(
      (tile) => tile.kind === kind && isBuildingAnchor(expanded, tile),
    );
    assert.equal(anchors.length, 1);
    assert.ok(
      getFootprint(expanded, anchors[0]).length > 1,
      'Expansion upgrades the old facility into its full-sized building',
    );
  }
  assert.doesNotThrow(() => deserializeCity(serializeCity(expanded)));
});

test('one thousand simulated months remain finite, bounded and deterministically loadable', () => {
  const city = createCity(2026, false, 40);
  for (let month = 0; month < 1000; month++) tick(city);
  const loaded = deserializeCity(serializeCity(city));
  assert.equal(loaded.month, 1000);
  assert.equal(loaded.history.length, 120);
  assert.ok(loaded.events.length <= 40);
  assert.equal(loaded.history.at(-1)!.month, 1000);
  assert.deepEqual(loaded.stats, city.stats);
  assert.ok(
    loaded.tiles.every(
      (tile) => tile.level >= 0 && tile.level <= 4 && Number.isFinite(tile.pollution),
    ),
  );
  assert.ok(Object.values(loaded.stats).every(Number.isFinite));
  tick(city);
  tick(loaded);
  assert.deepEqual(loaded.stats, city.stats);
  assert.equal(loaded.money, city.money);
});

const citizenIncident = (
  overrides: Partial<Omit<CitizenIncident, 'id' | 'month'>> = {},
): Omit<CitizenIncident, 'id' | 'month'> => ({
  x: 15.25,
  y: 1.5,
  z: 9.75,
  nx: 0,
  ny: 1,
  nz: 0,
  witnessed: false,
  kind: 'impact',
  ...overrides,
});

test('new cities and pre-citizen version-two saves start with no citizen losses or incidents', () => {
  const city = createCity(2026, false, 40);
  assert.deepEqual(city.citizenEffects, { populationLoss: 0, happinessPenalty: 0, incidents: [] });
  const older = JSON.parse(serializeCity(city));
  delete older.citizenEffects;
  const loaded = deserializeCity(JSON.stringify(older));
  assert.deepEqual(loaded.citizenEffects, {
    populationLoss: 0,
    happinessPenalty: 0,
    incidents: [],
  });
  assert.equal(loaded.stats.population, city.stats.population);
  assert.equal(loaded.stats.happiness, city.stats.happiness);
});

test('each citizen incident removes exactly one resident without modifying building levels or double counting', () => {
  for (const kind of ['impact', 'abduction'] as const) {
    const city = district(),
      population = city.stats.population;
    const levels = city.tiles.map((tile) => tile.level),
      month = city.month;
    const result = applyCitizenIncident(city, citizenIncident({ kind }));
    assert.ok(result.ok, result.message);
    assert.equal(city.citizenEffects.populationLoss, 1);
    assert.equal(city.citizenEffects.happinessPenalty, 0);
    assert.equal(city.stats.population, population - 1);
    assert.deepEqual(
      city.tiles.map((tile) => tile.level),
      levels,
    );
    assert.equal(city.month, month);
    assert.equal(city.citizenEffects.incidents.length, 1);
    assert.equal(city.citizenEffects.incidents[0].kind, kind);
    assert.equal(city.citizenEffects.incidents[0].month, month);
    for (let i = 0; i < 3; i++) recalculate(city);
    assert.equal(city.stats.population, population - 1);
    const loaded = deserializeCity(serializeCity(city));
    assert.equal(loaded.stats.population, population - 1);
    assert.deepEqual(loaded.citizenEffects, city.citizenEffects);
    recalculate(loaded);
    assert.equal(loaded.stats.population, population - 1);
    assert.ok(applyCitizenIncident(loaded, citizenIncident({ kind })).ok);
    assert.equal(loaded.stats.population, population - 2);
    assert.equal(loaded.citizenEffects.populationLoss, 2);
  }
});

test('only witnessed incidents add two happiness penalty points, capped at thirty', () => {
  const witnessed = district(),
    hidden = district();
  assert.ok(applyCitizenIncident(witnessed, citizenIncident({ witnessed: true })).ok);
  assert.ok(applyCitizenIncident(hidden, citizenIncident({ witnessed: false })).ok);
  assert.equal(witnessed.stats.population, hidden.stats.population);
  assert.equal(witnessed.citizenEffects.happinessPenalty, 2);
  assert.equal(hidden.citizenEffects.happinessPenalty, 0);
  assert.equal(witnessed.stats.happiness, hidden.stats.happiness - 2);
  for (let i = 1; i < 20; i++) {
    assert.ok(applyCitizenIncident(witnessed, citizenIncident({ witnessed: true })).ok);
    assert.ok(applyCitizenIncident(hidden, citizenIncident({ witnessed: false })).ok);
    assert.equal(witnessed.citizenEffects.happinessPenalty, Math.min(30, (i + 1) * 2));
    assert.equal(hidden.citizenEffects.happinessPenalty, 0);
  }
  assert.equal(witnessed.citizenEffects.populationLoss, 20);
  assert.equal(hidden.citizenEffects.populationLoss, 20);
  assert.equal(witnessed.stats.happiness, Math.max(0, hidden.stats.happiness - 30));
});

test('an empty city cannot lose citizens and incident losses cannot exceed its housing population', () => {
  const city = flatCity(),
    empty = JSON.stringify(city);
  assert.equal(applyCitizenIncident(city, citizenIncident({ witnessed: true })).ok, false);
  assert.equal(JSON.stringify(city), empty);
  construct(city, { x: 15, z: 9 }, 'residential');
  tileAt(city, 15, 9).level = 1;
  recalculate(city);
  const population = city.stats.population;
  assert.ok(population > 0);
  for (let i = 0; i < population; i++) {
    assert.ok(applyCitizenIncident(city, citizenIncident()).ok);
    assert.equal(city.stats.population, population - i - 1);
  }
  assert.equal(city.citizenEffects.populationLoss, population);
  const exhausted = JSON.stringify(city);
  assert.equal(applyCitizenIncident(city, citizenIncident({ witnessed: true })).ok, false);
  assert.equal(JSON.stringify(city), exhausted);
  assert.equal(city.stats.population, 0);
  assert.equal(deserializeCity(serializeCity(city)).stats.population, 0);
});

test('incident history keeps the most recent sixty-four while losses and IDs continue increasing', () => {
  const city = createCity(531, false, 40),
    population = city.stats.population;
  let lastId = -1;
  for (let i = 0; i < 80; i++) {
    assert.ok(applyCitizenIncident(city, citizenIncident()).ok);
    const latestId = Math.max(...city.citizenEffects.incidents.map((incident) => incident.id));
    assert.ok(latestId > lastId, 'New incident IDs remain monotonic after history truncation');
    lastId = latestId;
    assert.equal(city.citizenEffects.incidents.length, Math.min(64, i + 1));
    assert.equal(city.citizenEffects.populationLoss, i + 1);
    assert.equal(city.stats.population, population - i - 1);
  }
  assert.equal(new Set(city.citizenEffects.incidents.map((incident) => incident.id)).size, 64);
  const loaded = deserializeCity(serializeCity(city));
  assert.ok(applyCitizenIncident(loaded, citizenIncident()).ok);
  assert.ok(Math.max(...loaded.citizenEffects.incidents.map((incident) => incident.id)) > lastId);
  assert.equal(loaded.citizenEffects.populationLoss, 81);
  assert.equal(loaded.citizenEffects.incidents.length, 64);
});

test('citizen incidents reject malformed positions, surface normals and metadata without mutation', () => {
  const city = district();
  const badInputs: Record<string, unknown>[] = [
    { x: Number.NaN },
    { y: Number.POSITIVE_INFINITY },
    { z: Number.NEGATIVE_INFINITY },
    { x: -8.01 },
    { x: city.size + 8.01 },
    { z: -8.01 },
    { z: city.size + 8.01 },
    { y: -16.01 },
    { y: 128.01 },
    { x: '15' },
    { witnessed: 1 },
    { witnessed: 'true' },
    { kind: 'unknown' },
    { nx: 1.01 },
    { ny: -1.01 },
    { nz: Number.NaN },
    { nx: 0, ny: 0, nz: 0 },
  ];
  for (const bad of badInputs) {
    const before = JSON.stringify(city);
    const result = applyCitizenIncident(city, { ...citizenIncident(), ...bad } as Omit<
      CitizenIncident,
      'id' | 'month'
    >);
    assert.equal(result.ok, false, `Should reject ${JSON.stringify(bad)}`);
    assert.equal(
      JSON.stringify(city),
      before,
      'Rejected physical incidents cannot change simulation state',
    );
  }
  assert.ok(
    applyCitizenIncident(
      city,
      citizenIncident({ x: -8, y: -16, z: city.size + 8, nx: -1, ny: 0, nz: 1 }),
    ).ok,
  );
  assert.ok(
    applyCitizenIncident(
      city,
      citizenIncident({ x: city.size + 8, y: 128, z: -8, nx: 1, ny: 0, nz: 0 }),
    ).ok,
  );
});

test('save validation rejects malformed citizen effects and invalid stored incident data', () => {
  const city = district();
  assert.ok(applyCitizenIncident(city, citizenIncident({ witnessed: true })).ok);
  const saved = serializeCity(city);
  const corruptions: ((raw: any) => void)[] = [
    (raw) => {
      raw.citizenEffects.populationLoss = -1;
    },
    (raw) => {
      raw.citizenEffects.populationLoss = 0.5;
    },
    (raw) => {
      raw.citizenEffects.happinessPenalty = 31;
    },
    (raw) => {
      raw.citizenEffects.incidents[0].x = raw.size + 9;
    },
    (raw) => {
      raw.citizenEffects.incidents[0].y = 129;
    },
    (raw) => {
      raw.citizenEffects.incidents[0].month = raw.month + 1;
    },
    (raw) => {
      raw.citizenEffects.incidents[0].witnessed = 'true';
    },
    (raw) => {
      raw.citizenEffects.incidents[0].kind = 'unknown';
    },
    (raw) => {
      raw.citizenEffects.incidents[0].nx = 0;
      raw.citizenEffects.incidents[0].ny = 0;
      raw.citizenEffects.incidents[0].nz = 0;
    },
    (raw) => {
      raw.citizenEffects.incidents = Array.from({ length: 65 }, (_, i) => ({
        ...raw.citizenEffects.incidents[0],
        id: i + 1,
      }));
    },
  ];
  for (const corrupt of corruptions) {
    const raw = JSON.parse(saved);
    corrupt(raw);
    assert.throws(
      () => deserializeCity(JSON.stringify(raw)),
      `Should reject ${corrupt.toString()}`,
    );
  }
});

test('expansion preserves citizen impact grid coordinates, losses and penalties exactly once', () => {
  const city = district();
  assert.ok(
    applyCitizenIncident(city, citizenIncident({ x: 12.25, y: 3.125, z: 19.875, witnessed: true }))
      .ok,
  );
  const effects = structuredClone(city.citizenEffects),
    population = city.stats.population;
  const expanded = expandCity(city, 128);
  assert.deepEqual(
    expanded.citizenEffects,
    effects,
    'Incident coordinates are grid coordinates and do not shift with world origin',
  );
  assert.equal(expanded.stats.population, population);
  recalculate(expanded);
  assert.equal(expanded.stats.population, population);
  const loaded = deserializeCity(serializeCity(expanded));
  assert.deepEqual(loaded.citizenEffects, effects);
  assert.equal(loaded.stats.population, population);
});

test('fresh starter cities begin at stage zero with every zone at building level two or below', () => {
  for (const size of [40, 128]) {
    const city = createCity(2026, false, size);
    assert.equal(city.progression.rank, 0);
    assert.ok(city.stats.population > 500 && city.stats.population < 5000);
    const zones = city.tiles.filter((tile) =>
      ['residential', 'commercial', 'industrial'].includes(tile.kind),
    );
    assert.ok(zones.length > 0);
    assert.ok(zones.every((tile) => tile.level <= 2));
  }
});

test('stage-zero growth never develops a zone beyond building level two', () => {
  const city = district();
  for (const tile of city.tiles)
    if (['residential', 'commercial', 'industrial'].includes(tile.kind)) tile.level = 2;
  city.progression.rank = 0;
  recalculate(city);
  for (let month = 0; month < 120; month++) {
    tick(city);
    assert.equal(city.progression.rank, 0);
    assert.ok(
      city.tiles.every(
        (tile) =>
          !['residential', 'commercial', 'industrial'].includes(tile.kind) || tile.level <= 2,
      ),
    );
  }
});

test('higher city stages permit every zone type to grow to levels three and four respectively', () => {
  for (const [rank, initial, maximum] of [
    [1, 2, 3],
    [2, 3, 4],
  ]) {
    const city = district();
    construct(city, { x: 13, z: 9 }, 'residential');
    city.progression.rank = rank;
    for (const x of [13, 15, 17, 19]) tileAt(city, x, 9).level = initial;
    recalculate(city);
    const tracked = [tileAt(city, 15, 9), tileAt(city, 17, 9), tileAt(city, 19, 9)];
    const peaks = tracked.map((tile) => tile.level);
    for (let month = 0; month < 80; month++) {
      tick(city);
      tracked.forEach((tile, i) => {
        peaks[i] = Math.max(peaks[i], tile.level);
        assert.ok(tile.level <= maximum);
      });
    }
    tracked.forEach((tile, i) =>
      assert.equal(
        peaks[i],
        maximum,
        `Stage ${rank} must permit ${tile.kind} growth to level ${maximum}`,
      ),
    );
  }
});

test('existing high-level buildings remain intact when a lower-stage city is recalculated or imported', () => {
  const city = district();
  city.progression.rank = 0;
  tileAt(city, 15, 9).level = 4;
  tileAt(city, 17, 9).level = 3;
  tileAt(city, 19, 9).level = 4;
  recalculate(city);
  assert.equal(tileAt(city, 15, 9).level, 4);
  assert.equal(tileAt(city, 17, 9).level, 3);
  assert.equal(tileAt(city, 19, 9).level, 4);
  const loaded = deserializeCity(serializeCity(city));
  assert.equal(loaded.progression.rank, 0);
  assert.equal(tileAt(loaded, 15, 9).level, 4);
  assert.equal(tileAt(loaded, 17, 9).level, 3);
  assert.equal(tileAt(loaded, 19, 9).level, 4);
});

test('day-night settings default for new and older cities and persist through save and expansion', () => {
  const city = createCity(602, false, 40);
  assert.equal(city.settings.dayNightCycle, true);
  assert.equal(city.settings.timeOfDay, 14);
  const previousVersion = JSON.parse(serializeCity(city));
  delete previousVersion.settings.dayNightCycle;
  delete previousVersion.settings.timeOfDay;
  const migrated = deserializeCity(JSON.stringify(previousVersion));
  assert.equal(migrated.settings.dayNightCycle, true);
  assert.equal(migrated.settings.timeOfDay, 14);
  for (const hour of [0, 23.75]) {
    city.settings.dayNightCycle = false;
    city.settings.timeOfDay = hour;
    const loaded = deserializeCity(serializeCity(city));
    assert.equal(loaded.settings.dayNightCycle, false);
    assert.equal(loaded.settings.timeOfDay, hour);
    const expanded = expandCity(loaded, 128);
    assert.equal(expanded.settings.dayNightCycle, false);
    assert.equal(expanded.settings.timeOfDay, hour);
  }
});

test('building lights are independently switched, migrated and saved', () => {
  const city = createCity(7341, false, 64);
  assert.equal(city.settings.buildingLights, true);
  const previous = JSON.parse(serializeCity(city));
  delete previous.settings.buildingLights;
  assert.equal(deserializeCity(JSON.stringify(previous)).settings.buildingLights, true);
  city.settings.buildingLights = false;
  city.settings.timeOfDay = 21;
  city.settings.dayNightCycle = true;
  const loaded = deserializeCity(serializeCity(city));
  assert.equal(loaded.settings.buildingLights, false);
  assert.equal(loaded.settings.timeOfDay, 21);
  assert.equal(loaded.settings.dayNightCycle, true);
  assert.equal(expandCity(loaded, 128).settings.buildingLights, false);
  const invalid = JSON.parse(serializeCity(city));
  invalid.settings.buildingLights = 'false';
  assert.throws(() => deserializeCity(JSON.stringify(invalid)), /Gebäudelichter/);
});

test('save validation rejects invalid day-night switches and hours outside the twenty-four-hour clock', () => {
  const saved = serializeCity(createCity(602, true, 40));
  for (const [key, values] of [
    ['timeOfDay', [24, -1, Number.NaN, Number.POSITIVE_INFINITY, '14', true]],
    ['dayNightCycle', [0, 1, 'true', null]],
  ] as const)
    for (const value of values) {
      const raw = JSON.parse(saved);
      raw.settings[key] = value;
      assert.throws(
        () => deserializeCity(JSON.stringify(raw)),
        `Reject invalid ${key}: ${String(value)}`,
      );
    }
});

test('the unlocked citizen interaction tool cannot paint or mutate construction tiles', () => {
  const city = district();
  unlock(city, 'citizen');
  const before = JSON.stringify(city);
  const result = build(
    city,
    [
      { x: 15, z: 9 },
      { x: 16, z: 9 },
    ],
    'citizen',
  );
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(city), before);
});

test('tool definitions and immediate construction results follow locale changes without re-importing modules', () => {
  const previous = getLocale();
  try {
    const definition = TOOL_DEFS.powerline!;
    setLocale('de');
    assert.equal(definition.name, 'Stromleitung');
    assert.match(definition.description, /von Straßen umschlossenen Blocks/);
    const city = flatCity();
    assert.match(previewBuild(city, [{ x: -1, z: 5 }], 'road').message, /Außerhalb/);
    setLocale('en');
    assert.equal(definition.name, 'Power line');
    assert.match(definition.description, /enclosed street block/);
    assert.equal(previewBuild(city, [{ x: -1, z: 5 }], 'road').message, 'Outside the city limits.');
    assert.match(build(city, [{ x: 10, z: 10 }], 'road').message, /tile built/);
    assert.match(takeLoan(city).message, /Borrowed €10,000/);
    assert.match(repayLoan(city).message, /Repaid €10,000/);
    setLocale('de');
    assert.equal(definition.name, 'Stromleitung');
  } finally {
    setLocale(previous);
  }
});

test('simulation events preserve German and English text through saves and locale switches', () => {
  const previous = getLocale();
  try {
    setLocale('en');
    const city = flatCity();
    takeLoan(city);
    const event = city.events.find((event) => event.title === 'Kredit ausgezahlt')!;
    assert.ok(event);
    assert.equal(event.titleEn, 'Loan paid out');
    assert.match(event.message, /10.000 €/);
    assert.match(event.messageEn!, /€10,000/);
    const loaded = deserializeCity(serializeCity(city));
    const loadedEvent = loaded.events.find((candidate) => candidate.id === event.id)!;
    assert.equal(localizedEventTitle(loadedEvent), 'Loan paid out');
    assert.match(localizedEventMessage(loadedEvent), /Interest is included in the running balance/);
    setLocale('de');
    assert.equal(localizedEventTitle(loadedEvent), 'Kredit ausgezahlt');
    assert.match(
      localizedEventMessage(loadedEvent),
      /Zinsen sind in der laufenden Bilanz enthalten/,
    );
  } finally {
    setLocale(previous);
  }
});

test('save errors use the current locale and optional English event fields are strictly validated', () => {
  const previous = getLocale();
  try {
    const raw = JSON.parse(serializeCity(flatCity()));
    setLocale('en');
    assert.throws(() => deserializeCity('broken json'), /saved game does not contain valid JSON/);
    raw.events[0].titleEn = 42;
    assert.throws(() => deserializeCity(JSON.stringify(raw)), /English event title/);
    raw.events[0].titleEn = 'Valid';
    raw.events[0].messageEn = [];
    assert.throws(() => deserializeCity(JSON.stringify(raw)), /English event message/);
    delete raw.events[0].titleEn;
    delete raw.events[0].messageEn;
    assert.doesNotThrow(
      () => deserializeCity(JSON.stringify(raw)),
      'Older monolingual events remain importable',
    );
    raw.money = 'invalid';
    assert.throws(() => deserializeCity(JSON.stringify(raw)), /Invalid saved game: Treasury/);
    setLocale('de');
    assert.throws(() => deserializeCity(JSON.stringify(raw)), /Ungültiger Spielstand: Stadtkasse/);
  } finally {
    setLocale(previous);
  }
});
