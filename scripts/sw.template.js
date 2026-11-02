/* LightweightBaby service worker (generated into dist/sw.js by scripts/build-sw.mjs).
 *
 * - Precaches the app itself (HTML, JS, fonts, icons) so it opens with no
 *   connection. Only same-origin files of this app are ever cached.
 * - Never touches other origins: Supabase API, Edge Functions, storage and
 *   Google sign-in always go straight to the network.
 * - A new deploy installs in the background and waits; the app shows
 *   "Update available" and the user taps to switch (SKIP_WAITING).
 * - Web push (send-push Edge Function): shows the notification; a tap opens
 *   or focuses the app on the right screen. The rest timer push is skipped
 *   while the app is on screen (the app plays its own alert then).
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
    // caches.match (not caches.open) never re-creates a cache that was cleared.
    event.respondWith(
      caches.match('/', { cacheName: CACHE }).then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(url.pathname, { cacheName: CACHE }).then((cached) => cached || fetch(request)),
  );
});

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  const tag = typeof msg.tag === 'string' ? msg.tag : undefined;
  const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
  event.waitUntil(
    (async () => {
      if (tag && tag.startsWith('rest')) {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (windows.some((c) => c.visibilityState === 'visible')) return;
      }
      await self.registration.showNotification(msg.title || 'LightweightBaby', {
        body: msg.body || '',
        tag,
        renotify: Boolean(tag && tag.startsWith('rest')),
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        data,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  // Only paths inside this app.
  const path = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({ type: 'OPEN_URL', url: path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
