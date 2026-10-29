import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { subscribeOnline } from '@/lib/platform/network';

let started = false;

/** TanStack Query (paused queries, sync) follows the device's connection. */
export function startNetworkWatch() {
  if (started) return;
  started = true;
  onlineManager.setEventListener((setOnline) => subscribeOnline(setOnline));
}

export function useIsOnline() {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}
