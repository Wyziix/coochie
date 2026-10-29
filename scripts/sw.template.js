/* LightweightBaby service worker (generated into dist/sw.js by scripts/build-sw.mjs).
 *
 * - Precaches the app itself (HTML, JS, fonts, icons) so it opens with no
 *   connection. Only same-origin files of this app are ever cached.
 * - Never touches other origins: Supabase API, Edge Functions, storage and
 *   Google sign-in always go straight to the network.
 * - A new deploy installs in the background and waits; the app shows
 *   "Update available" and the user taps to switch (SKIP_WAITING).
 */
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `lightweightbaby-app-${VERSION}`;
const PREFIX = 'lightweightbaby-app-';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Other origins (Supabase, Edge Functions, Google, signed photo URLs): not ours.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    // Every page of the app is the same single-page shell.
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match('/'))
        .then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(url.pathname))
      .then((cached) => cached || fetch(request)),
  );
});
