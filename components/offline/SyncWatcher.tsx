import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { flushPersistedQueries, warmOfflineCache } from '@/lib/offline/cache';
import { useOutboxStore } from '@/lib/offline/outbox';
import { setSyncQueryClient, syncNow } from '@/lib/offline/sync';
import { useUserId } from '@/stores/authStore';
import { useWorkoutStore } from '@/stores/workoutStore';

/**
 * Sends queued changes when the app opens, when the connection comes back,
 * when the app returns to the foreground, and every minute while some wait.
 * While online it also keeps the gym data cached for offline use.
 */
export function SyncWatcher() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  const loaded = useOutboxStore((s) => s.loaded);
  const waiting = useOutboxStore((s) => s.items.some((i) => i.status === 'pending'));

  useEffect(() => {
    setSyncQueryClient(queryClient);
    return () => setSyncQueryClient(null);
  }, [queryClient]);

  // A workout in progress from another account is never finished into this one.
  useEffect(() => {
    const workout = useWorkoutStore.getState().workout;
    if (workout?.ownerId && workout.ownerId !== userId) useWorkoutStore.getState().discard();
  }, [userId]);

  useEffect(() => {
    if (!loaded) return;
    syncNow();
    if (onlineManager.isOnline()) warmOfflineCache(queryClient).catch(() => {});
  }, [loaded, queryClient]);

  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        if (!online) return;
        syncNow();
        warmOfflineCache(queryClient).catch(() => {});
      }),
    [queryClient],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && onlineManager.isOnline()) syncNow();
      // The app may be closed next; keep the offline copy up to date.
      if (state === 'background') flushPersistedQueries();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      if (onlineManager.isOnline()) syncNow();
    }, 60_000);
    return () => clearInterval(id);
  }, [waiting]);

  return null;
}
