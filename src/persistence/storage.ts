/** Browser persistence. The original v1 save is deliberately never changed. */
import { tr } from '../i18n/index';
export const CITY_DATABASE_NAME = 'neustadt-db';
export const CITY_DATABASE_STORE = 'game';
export const LEGACY_CITY_KEY = 'neustadt-save-v1';
export const FALLBACK_CITY_KEY = 'neustadt-save-v2';

export interface SavedCityResult {
  raw: string | null;
  source: 'indexeddb' | 'legacy' | 'none';
  error?: string;
}

interface StoredCity {
  storageVersion: 2;
  raw: string;
  savedAt: number;
}

/** Small dependency boundary also used by the persistence regression tests. */
export interface CityStorageDatabase {
  read(key: string): Promise<unknown>;
  write(key: string, value: StoredCity): Promise<void>;
  writeIfAbsent(key: string, value: StoredCity): Promise<void>;
}

type LocalStore = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;
interface StorageOptions {
  database?: CityStorageDatabase | null;
  localStorage?: () => LocalStore | null;
  now?: () => number;
}

function browserLocalStorage(): LocalStore | null {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

function storageError(action: 'load' | 'save' | 'backup'): Error {
  if (action === 'load')
    return new Error(
      tr(
        'Der Browserspeicher konnte nicht vollständig gelesen werden. Der vorhandene Spielstand bleibt erhalten. Exportiere deine Stadt vor weiteren Speicheränderungen.',
        'Browser storage could not be fully read. Your existing save is preserved. Export your city before making further changes to storage.',
      ),
    );
  if (action === 'backup')
    return new Error(
      tr(
        'Die zusätzliche Sicherung konnte nicht angelegt werden. Der ursprüngliche Spielstand bleibt unverändert im Browser erhalten.',
        'The additional backup could not be created. Your original save remains unchanged in this browser.',
      ),
    );
  return new Error(
    tr(
      'Spielstand konnte nicht gespeichert werden. Exportiere deine Stadt im Stadtmenü als Datei. Prüfe freien Speicherplatz und erlaube dieser Seite Browserspeicher; im privaten Modus kann der Speicher begrenzt sein.',
      'Your city could not be saved. Export it as a file from the city menu. Check available space and allow browser storage for this site; private browsing may limit storage.',
    ),
  );
}

/**
 * Old/plain or malformed records are returned untouched for deserializeCity to
 * validate. An unrecognised local v2 record wins over older database data, so a
 * damaged newest save can never silently be replaced with an earlier city.
 */
function decodeRecord(value: unknown, unknownTime: number): StoredCity | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && value !== null) {
    const record = value as Partial<StoredCity>;
    if (
      record.storageVersion === 2 &&
      typeof record.raw === 'string' &&
      typeof record.savedAt === 'number' &&
      Number.isFinite(record.savedAt)
    ) {
      return record as StoredCity;
    }
  }
  let raw: string;
  try {
    raw = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    raw = '{"invalidStorageRecord":true}';
  }
  return { storageVersion: 2, raw, savedAt: unknownTime };
}

function decodeLocalRecord(raw: string | null): StoredCity | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Partial<StoredCity>).storageVersion === 2
    ) {
      return decodeRecord(parsed, Number.POSITIVE_INFINITY);
    }
  } catch {
    /* A corrupt city must reach validation, not disappear. */
  }
  return decodeRecord(raw, Number.POSITIVE_INFINITY);
}

/** IndexedDB requests are bounded, atomic, and only resolve after commit. */
function browserDatabase(): CityStorageDatabase | null {
  let factory: IDBFactory;
  try {
    if (!globalThis.indexedDB) return null;
    factory = globalThis.indexedDB;
  } catch {
    return null;
  }

  let connection: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  const timeoutMs = 2500;

  function open(): Promise<IDBDatabase> {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      let finished = false;
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('IndexedDB connection timed out.')), timeoutMs);
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(CITY_DATABASE_NAME, 1);
      } catch (error) {
        fail(error);
        return;
      }
      request.onblocked = () =>
        fail(new Error('IndexedDB upgrade is blocked by another open tab.'));
      request.onerror = () => fail(request.error ?? new Error('IndexedDB could not open.'));
      request.onupgradeneeded = () => {
        if (finished) {
          request.transaction?.abort();
          return;
        }
        const database = request.result;
        if (!database.objectStoreNames.contains(CITY_DATABASE_STORE))
          database.createObjectStore(CITY_DATABASE_STORE);
      };
      request.onsuccess = () => {
        const database = request.result;
        if (finished) {
          database.close();
          return;
        }
        finished = true;
        clearTimeout(timer);
        connection = database;
        const discard = () => {
          if (connection === database) connection = null;
        };
        database.onversionchange = () => {
          database.close();
          discard();
        };
        database.onclose = discard;
        resolve(database);
      };
    }).finally(() => {
      opening = null;
    });
    return opening;
  }

  async function transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, value: (result: T) => void) => void,
  ): Promise<T> {
    const startedAt = Date.now();
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        // Strict durability asks supporting browsers to flush a completed write.
        try {
          tx = database.transaction(CITY_DATABASE_STORE, mode, {
            durability: mode === 'readwrite' ? 'strict' : 'default',
          });
        } catch {
          tx = database.transaction(CITY_DATABASE_STORE, mode);
        }
      } catch (error) {
        if (connection === database) connection = null;
        database.close();
        reject(error);
        return;
      }
      let result: T;
      let finished = false;
      const timer = setTimeout(
        () => {
          if (finished) return;
          finished = true;
          // Abort before allowing a fallback or subsequent write to proceed.
          try {
            tx.abort();
          } catch {
            /* Transaction may have finished meanwhile. */
          }
          reject(new Error('IndexedDB transaction timed out.'));
        },
        Math.max(1, timeoutMs - (Date.now() - startedAt)),
      );
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      };
      tx.onabort = () => fail(tx.error ?? new Error('IndexedDB transaction aborted.'));
      tx.onerror = () => {
        const error = tx.error ?? new Error('IndexedDB transaction failed.');
        try {
          tx.abort();
        } catch {
          /* already aborted */
        }
        fail(error);
      };
      tx.oncomplete = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(result!);
      };
      try {
        operation(tx.objectStore(CITY_DATABASE_STORE), (value) => {
          result = value;
        });
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* already aborted */
        }
        fail(error);
      }
    });
  }

  return {
    read: (key) =>
      transaction<unknown>('readonly', (store, value) => {
        const request = store.get(key);
        request.onsuccess = () => value(request.result);
      }),
    write: (key, record) =>
      transaction<void>('readwrite', (store) => {
        store.put(record, key);
      }),
    writeIfAbsent: (key, record) =>
      transaction<void>('readwrite', (store) => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result === undefined) store.put(record, key);
        };
      }),
  };
}

export function createCityStorage(options: StorageOptions = {}) {
  const database = options.database === undefined ? browserDatabase() : options.database;
  const getLocal = options.localStorage ?? browserLocalStorage;
  const now = options.now ?? Date.now;
  let lastSavedAt = 0;
  let writeQueue: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): Promise<void> {
    const task = writeQueue.catch(() => {}).then(work);
    writeQueue = task;
    return task;
  }

  function record(raw: string): StoredCity {
    lastSavedAt = Math.max(now(), lastSavedAt + 1);
    return { storageVersion: 2, raw, savedAt: lastSavedAt };
  }

  async function loadSavedCity(): Promise<SavedCityResult> {
    // Also safe when an explicit reload races an outstanding manual save.
    await writeQueue.catch(() => {});
    let databaseRecord: StoredCity | null = null;
    let localRecord: StoredCity | null = null;
    let local: LocalStore | null = null;
    let databaseFailed = false;
    let localFailed = false;
    if (database) {
      try {
        databaseRecord = decodeRecord(await database.read('current'), 0);
      } catch {
        databaseFailed = true;
      }
    }
    try {
      local = getLocal();
      if (local) localRecord = decodeLocalRecord(local.getItem(FALLBACK_CITY_KEY));
      else localFailed = true;
    } catch {
      localFailed = true;
    }

    const current =
      localRecord && (!databaseRecord || localRecord.savedAt > databaseRecord.savedAt)
        ? localRecord
        : databaseRecord;
    if (current) {
      if (Number.isFinite(current.savedAt)) lastSavedAt = Math.max(lastSavedAt, current.savedAt);
      const result: SavedCityResult = {
        raw: current.raw,
        source: current === databaseRecord ? 'indexeddb' : 'legacy',
      };
      // If the database could not be read, a local copy may be out of date.
      if (databaseFailed || localFailed) result.error = storageError('load').message;
      return result;
    }
    let legacyRaw: string | null = null;
    try {
      if (local) legacyRaw = local.getItem(LEGACY_CITY_KEY);
    } catch {
      localFailed = true;
    }
    const result: SavedCityResult = {
      raw: legacyRaw,
      source: legacyRaw === null ? 'none' : 'legacy',
    };
    if (databaseFailed || localFailed) result.error = storageError('load').message;
    return result;
  }

  function saveCityRaw(raw: string): Promise<void> {
    return enqueue(async () => {
      let fallbackBeforeSave: string | null = null;
      try {
        fallbackBeforeSave = getLocal()?.getItem(FALLBACK_CITY_KEY) ?? null;
        const previous = decodeLocalRecord(fallbackBeforeSave);
        if (previous && Number.isFinite(previous.savedAt))
          lastSavedAt = Math.max(lastSavedAt, previous.savedAt);
      } catch {
        /* IndexedDB can still save when local storage is unavailable. */
      }
      const value = record(raw);
      if (database) {
        try {
          await database.write('current', value);
          // Discard only the exact fallback observed before this successful
          // commit. A different tab's newer fallback must remain untouched.
          try {
            const local = getLocal();
            if (
              fallbackBeforeSave !== null &&
              local?.getItem(FALLBACK_CITY_KEY) === fallbackBeforeSave
            )
              local.removeItem?.(FALLBACK_CITY_KEY);
          } catch {
            /* Cleaning an obsolete fallback must not fail a committed save. */
          }
          return;
        } catch {
          /* The old database transaction is aborted; try local v2 only. */
        }
      }
      try {
        const local = getLocal();
        if (!local) throw new Error('Local storage unavailable.');
        local.setItem(FALLBACK_CITY_KEY, JSON.stringify(value));
      } catch {
        throw storageError('save');
      }
    });
  }

  function backupLegacy(raw: string): Promise<void> {
    return enqueue(async () => {
      if (!database) return; // v1 remains the original backup in localStorage.
      try {
        await database.writeIfAbsent('legacy-backup', record(raw));
      } catch {
        throw storageError('backup');
      }
    });
  }

  function safePreferenceGet(key: string): string | null {
    try {
      return getLocal()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function safePreferenceSet(key: string, value: string): boolean {
    if (key === LEGACY_CITY_KEY) return false;
    try {
      const local = getLocal();
      if (!local) return false;
      local.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  return { loadSavedCity, saveCityRaw, backupLegacy, safePreferenceGet, safePreferenceSet };
}

const browserStorage = createCityStorage();
export const loadSavedCity = browserStorage.loadSavedCity;
export const saveCityRaw = browserStorage.saveCityRaw;
export const backupLegacy = browserStorage.backupLegacy;
export const safePreferenceGet = browserStorage.safePreferenceGet;
export const safePreferenceSet = browserStorage.safePreferenceSet;
