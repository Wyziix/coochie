import type { OfflineStorage } from './types';

// Web: IndexedDB. Unlike SQLite on web it needs no cross-origin isolation
// headers, works in iPhone Safari and home-screen apps, and has room for far
// more than localStorage's ~5 MB. If IndexedDB isn't available (some private
// modes), fall back to memory: the app still works, it just won't remember
// offline data after closing.
const DB_NAME = 'lightweightbaby-offline';
const STORE = 'kv';

let db: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, string>();

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        if (!d) return reject(new Error('IndexedDB unavailable'));
        const tx = d.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

// Ask the browser not to clear this data under storage pressure.
try {
  navigator.storage?.persist?.().catch(() => {});
} catch {
  // not supported
}

export const offlineStorage: OfflineStorage = {
  async getItem(key) {
    try {
      const value = await run<unknown>('readonly', (s) => s.get(key));
      return typeof value === 'string' ? value : null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  async setItem(key, value) {
    try {
      await run('readwrite', (s) => s.put(value, key));
    } catch {
      memory.set(key, value);
    }
  },
  async removeItem(key) {
    memory.delete(key);
    try {
      await run('readwrite', (s) => s.delete(key));
    } catch {
      // nothing stored
    }
  },
};
