/**
 * Small async key-value store for offline data (the query cache and the sync
 * queue). IndexedDB on web, SQLite on Android; same interface everywhere.
 * Keys that hold user data include the user id.
 */
export type OfflineStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
