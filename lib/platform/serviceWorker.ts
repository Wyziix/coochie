// Native: no service worker. The app ships inside the APK.
export function registerServiceWorker() {}

export function useUpdateAvailable(): boolean {
  return false;
}

export function applyUpdate() {}
