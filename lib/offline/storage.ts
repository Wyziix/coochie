import * as SQLite from 'expo-sqlite';

import type { OfflineStorage } from './types';

// Android (and iOS dev builds): one SQLite table of key → JSON text.
let db: Promise<SQLite.SQLiteDatabase> | null = null;

function open() {
  db ??= SQLite.openDatabaseAsync('lightweightbaby-offline.db').then(async (d) => {
    await d.execAsync(
      'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
    );
    return d;
  });
  return db;
}

export const offlineStorage: OfflineStorage = {
  async getItem(key) {
    const row = await (
      await open()
    ).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row?.value ?? null;
  },
  async setItem(key, value) {
    await (
      await open()
    ).runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  },
  async removeItem(key) {
    await (await open()).runAsync('DELETE FROM kv WHERE key = ?', key);
  },
};
