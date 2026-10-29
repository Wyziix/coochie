import { useSyncExternalStore } from 'react';

// Web: the service worker (dist/sw.js, see scripts/build-sw.mjs) lets the app
// open offline. After a deploy the new version installs in the background and
// waits; we show "Update available" and switch only when the user taps.
let waiting: ServiceWorker | null = null;
let updating = false;
const listeners = new Set<() => void>();

function setWaiting(worker: ServiceWorker | null) {
  waiting = worker;
  listeners.forEach((l) => l());
}

export function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      // A new version is ready when one is waiting while an old one runs the page.
      const check = () => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      };
      check();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') check();
        });
      });
      // Look for a new deploy when the app comes back to the front, and every 30 minutes.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      setInterval(() => reg.update().catch(() => {}), 30 * 60_000);
    })
    .catch(() => {});

  // Reload only for an update the user asked for (not on the very first install).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating) return;
    updating = false;
    window.location.reload();
  });
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => waiting !== null,
    () => false,
  );
}

/** Switch to the new version: the page reloads when it takes over. */
export function applyUpdate() {
  if (!waiting) return;
  updating = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
