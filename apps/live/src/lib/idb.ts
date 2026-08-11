/**
 * A 90-line IndexedDB wrapper.
 *
 * Hand-rolled rather than pulled from npm: the door PWA's whole job is to work
 * when the network does not, and the smaller its offline-critical code is, the
 * fewer ways it has to fail on a five-year-old venue tablet.
 */

const DB_NAME = "ovation-live";
const DB_VERSION = 1;

export const STORE_QUEUE = "scan-queue";
export const STORE_CACHE = "cache";

let dbPromise: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, {
          keyPath: "idempotencyKey",
        });
        store.createIndex("byState", "state");
        store.createIndex("byScannedAt", "scannedAt");
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function idbPut<T>(store: string, value: T): Promise<IDBValidKey> {
  return run(store, "readwrite", (s) => s.put(value as never));
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, "readonly", (s) => s.get(key));
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return run<T[]>(store, "readonly", (s) => s.getAll());
}

export function idbDelete(store: string, key: IDBValidKey): Promise<undefined> {
  return run<undefined>(store, "readwrite", (s) => s.delete(key));
}

export function idbClear(store: string): Promise<undefined> {
  return run<undefined>(store, "readwrite", (s) => s.clear());
}
