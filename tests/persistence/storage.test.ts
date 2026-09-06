import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCityStorage,
  FALLBACK_CITY_KEY,
  LEGACY_CITY_KEY,
  type CityStorageDatabase,
} from '../../src/persistence/storage.ts';

function memoryLocal(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function memoryDatabase() {
  const values = new Map<string, unknown>();
  const database: CityStorageDatabase = {
    read: async (key) => values.get(key),
    write: async (key, value) => {
      values.set(key, structuredClone(value));
    },
    writeIfAbsent: async (key, value) => {
      if (!values.has(key)) values.set(key, structuredClone(value));
    },
  };
  return { values, database };
}

test('a 4 MiB city is stored in IndexedDB without touching the quota-limited local store', async () => {
  const { database, values } = memoryDatabase();
  const raw = '{"tiles":"' + 'x'.repeat(4 * 1024 * 1024) + '"}';
  let localWrites = 0;
  const storage = createCityStorage({
    database,
    localStorage: () => ({
      getItem: () => null,
      setItem: () => {
        localWrites++;
        throw new Error('QuotaExceededError');
      },
    }),
  });
  await storage.saveCityRaw(raw);
  assert.deepEqual(await storage.loadSavedCity(), { raw, source: 'indexeddb' });
  assert.equal((values.get('current') as { raw: string }).raw.length, raw.length);
  assert.equal(localWrites, 0);
});

test('legacy saves are read unchanged and the first migration backup is preserved', async () => {
  const legacy = '{"version":1,"name":"Original"}',
    current = '{"version":2,"name":"Updated"}';
  const local = memoryLocal({ [LEGACY_CITY_KEY]: legacy });
  const { database, values } = memoryDatabase();
  const storage = createCityStorage({ database, localStorage: () => local });
  assert.deepEqual(await storage.loadSavedCity(), { raw: legacy, source: 'legacy' });
  await storage.backupLegacy(legacy);
  await storage.saveCityRaw(current);
  await storage.backupLegacy('must not replace the first backup');
  assert.equal((values.get('legacy-backup') as { raw: string }).raw, legacy);
  assert.equal(local.getItem(LEGACY_CITY_KEY), legacy);
  assert.equal(storage.safePreferenceSet(LEGACY_CITY_KEY, 'overwrite'), false);
  assert.deepEqual(await storage.loadSavedCity(), { raw: current, source: 'indexeddb' });
});

test('unavailable IndexedDB falls back to the v2 key and never changes v1', async () => {
  const local = memoryLocal({ [LEGACY_CITY_KEY]: 'old' });
  const storage = createCityStorage({ database: null, localStorage: () => local });
  await storage.saveCityRaw('new');
  assert.equal(local.getItem(LEGACY_CITY_KEY), 'old');
  assert.ok(local.getItem(FALLBACK_CITY_KEY));
  assert.deepEqual(await storage.loadSavedCity(), { raw: 'new', source: 'legacy' });
});

test('a newer fallback remains authoritative after IndexedDB recovers', async () => {
  const local = memoryLocal();
  const { database } = memoryDatabase();
  await createCityStorage({ database, localStorage: () => local, now: () => 100 }).saveCityRaw(
    'old database city',
  );
  const brokenDatabase: CityStorageDatabase = {
    ...database,
    write: async () => {
      throw new Error('unavailable');
    },
  };
  await createCityStorage({
    database: brokenDatabase,
    localStorage: () => local,
    now: () => 200,
  }).saveCityRaw('new fallback city');
  const recovered = createCityStorage({ database, localStorage: () => local, now: () => 150 });
  assert.deepEqual(await recovered.loadSavedCity(), { raw: 'new fallback city', source: 'legacy' });
  await recovered.saveCityRaw('latest database city');
  assert.deepEqual(await recovered.loadSavedCity(), {
    raw: 'latest database city',
    source: 'indexeddb',
  });
});

test('concurrent saves commit in invocation order and a failed save does not poison the queue', async () => {
  const local = memoryLocal();
  const { database, values } = memoryDatabase();
  let release: (() => void) | undefined;
  let writes = 0;
  let active = 0;
  let peakActive = 0;
  const delayed: CityStorageDatabase = {
    ...database,
    write: async (key, value) => {
      active++;
      peakActive = Math.max(peakActive, active);
      writes++;
      if (writes === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await database.write(key, value);
      active--;
    },
  };
  const storage = createCityStorage({
    database: delayed,
    localStorage: () => local,
    now: () => 100,
  });
  const first = storage.saveCityRaw('first');
  const second = storage.saveCityRaw('second');
  const third = storage.saveCityRaw('third');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1);
  release!();
  await Promise.all([first, second, third]);
  assert.equal(peakActive, 1);
  assert.equal((values.get('current') as { raw: string }).raw, 'third');
  assert.equal((values.get('current') as { savedAt: number }).savedAt, 102);

  let fail = true;
  const recovering = createCityStorage({
    database: {
      ...database,
      write: async (key, value) => {
        if (fail) throw new Error('unavailable');
        await database.write(key, value);
      },
    },
    localStorage: () => null,
  });
  await assert.rejects(recovering.saveCityRaw('failed'), /Exportiere/);
  fail = false;
  await recovering.saveCityRaw('successful retry');
  assert.equal((values.get('current') as { raw: string }).raw, 'successful retry');
});

test('corrupt current data is returned for validation instead of replaced by a legacy save', async () => {
  const local = memoryLocal({ [LEGACY_CITY_KEY]: 'valid old save' });
  const { database, values } = memoryDatabase();
  values.set('current', '{broken');
  const storage = createCityStorage({ database, localStorage: () => local });
  assert.deepEqual(await storage.loadSavedCity(), { raw: '{broken', source: 'indexeddb' });
  assert.equal(local.getItem(LEGACY_CITY_KEY), 'valid old save');
  local.setItem(FALLBACK_CITY_KEY, 'broken newest fallback');
  assert.deepEqual(await storage.loadSavedCity(), {
    raw: 'broken newest fallback',
    source: 'legacy',
  });
  await storage.saveCityRaw('explicitly imported replacement');
  assert.deepEqual(await storage.loadSavedCity(), {
    raw: 'explicitly imported replacement',
    source: 'indexeddb',
  });
  assert.equal(local.getItem(FALLBACK_CITY_KEY), null);
});

test('saving in one tab preserves a different fallback written meanwhile in another tab', async () => {
  const local = memoryLocal();
  const { database } = memoryDatabase();
  await createCityStorage({
    database: null,
    localStorage: () => local,
    now: () => 100,
  }).saveCityRaw('previous fallback');
  const concurrent: CityStorageDatabase = {
    ...database,
    write: async (key, value) => {
      await database.write(key, value);
      await createCityStorage({
        database: null,
        localStorage: () => local,
        now: () => 300,
      }).saveCityRaw('other tab latest');
    },
  };
  await createCityStorage({
    database: concurrent,
    localStorage: () => local,
    now: () => 200,
  }).saveCityRaw('this tab city');
  assert.deepEqual(
    await createCityStorage({ database, localStorage: () => local }).loadSavedCity(),
    { raw: 'other tab latest', source: 'legacy' },
  );
});

test('an unreadable local fallback is reported even when the primary database is readable', async () => {
  const { database } = memoryDatabase();
  await createCityStorage({ database, localStorage: () => null }).saveCityRaw('database city');
  const result = await createCityStorage({
    database,
    localStorage: () => {
      throw new Error('Denied');
    },
  }).loadSavedCity();
  assert.equal(result.raw, 'database city');
  assert.equal(result.source, 'indexeddb');
  assert.match(result.error!, /nicht vollständig gelesen/);
});

test('quota exhaustion rejects with an actionable export instruction and leaves existing data intact', async () => {
  const local = memoryLocal({ [LEGACY_CITY_KEY]: 'original' });
  const storage = createCityStorage({
    database: null,
    localStorage: () => ({
      getItem: local.getItem,
      setItem: () => {
        throw new DOMException('Full', 'QuotaExceededError');
      },
    }),
  });
  await assert.rejects(
    storage.saveCityRaw('new save'),
    /Exportiere deine Stadt im Stadtmenü als Datei/,
  );
  assert.equal(local.getItem(LEGACY_CITY_KEY), 'original');
  assert.equal(local.getItem(FALLBACK_CITY_KEY), null);
});

test('storage denial never breaks preferences and failed reads are explicitly reported', async () => {
  const storage = createCityStorage({
    database: null,
    localStorage: () => {
      throw new DOMException('Denied', 'SecurityError');
    },
  });
  assert.equal(storage.safePreferenceGet('quality'), null);
  assert.equal(storage.safePreferenceSet('quality', 'ultra'), false);
  const result = await storage.loadSavedCity();
  assert.equal(result.raw, null);
  assert.equal(result.source, 'none');
  assert.match(result.error!, /nicht vollständig gelesen/);
  await assert.rejects(storage.saveCityRaw('city'), /Spielstand konnte nicht gespeichert/);
});

test('a database read failure does not disguise an older local save as an unqualified successful load', async () => {
  const local = memoryLocal({ [LEGACY_CITY_KEY]: 'old city' });
  const { database } = memoryDatabase();
  const storage = createCityStorage({
    database: {
      ...database,
      read: async () => {
        throw new Error('read failed');
      },
    },
    localStorage: () => local,
  });
  const result = await storage.loadSavedCity();
  assert.equal(result.raw, 'old city');
  assert.equal(result.source, 'legacy');
  assert.match(result.error!, /nicht vollständig gelesen/);
  assert.equal(local.getItem(LEGACY_CITY_KEY), 'old city');
});

test('empty accessible storage reports no save and preferences round-trip normally', async () => {
  const local = memoryLocal();
  const storage = createCityStorage({ database: null, localStorage: () => local });
  assert.deepEqual(await storage.loadSavedCity(), { raw: null, source: 'none' });
  assert.equal(storage.safePreferenceSet('neustadt-quality', 'ultra'), true);
  assert.equal(storage.safePreferenceGet('neustadt-quality'), 'ultra');
});
