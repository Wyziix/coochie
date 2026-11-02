// After deleting the account: nothing of it stays in this browser. (The
// offline database is cleared and deleted by offlineStorage.clear().)
export async function wipeBrowserData(): Promise<void> {
  // The app's own caches (the service worker re-caches the app shell next time).
  try {
    for (const key of await caches.keys()) await caches.delete(key);
  } catch {
    // no Cache API
  }
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      store?.clear();
    } catch {
      // blocked storage
    }
  }
}
