import type { QueryClient } from '@tanstack/react-query';

import { clearPersistedQueries } from '@/lib/offline/cache';
import { offlineStorage } from '@/lib/offline/storage';
import { useOutboxStore } from '@/lib/offline/outbox';
import { clearLocalBiometrics } from '@/lib/photos/biometrics';
import { unregisterPush } from '@/lib/platform/push';
import { wipeBrowserData } from '@/lib/platform/wipe';
import { getSupabase } from '@/lib/supabase';
import { lockPhotos } from '@/stores/photoLockStore';
import { useEditWorkoutStore, useWorkoutStore } from '@/stores/workoutStore';

import { callFunction } from './functions';

/** Seconds since this session signed in (Google or email code), from the JWT; null if unknown. */
export function signedInSecondsAgo(
  accessToken: string | undefined,
  now = Date.now(),
): number | null {
  if (!accessToken) return null;
  try {
    const part = accessToken.split('.')[1] ?? '';
    const json = atob(
      part
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(part.length / 4) * 4, '='),
    );
    const amr = (JSON.parse(json) as { amr?: { timestamp?: number }[] }).amr ?? [];
    const times = amr.map((a) => a.timestamp ?? 0).filter((t) => t > 0);
    return times.length ? Math.max(0, Math.round(now / 1000 - Math.max(...times))) : null;
  } catch {
    return null;
  }
}

/** Must match the server (delete-account: 10 minutes). */
export const RECENT_SIGN_IN_SECONDS = 10 * 60;

/** Deletes the account on the server, then everything about it on this device. */
export async function deleteAccount(username: string, queryClient: QueryClient): Promise<void> {
  await callFunction('delete-account', { body: { username } });
  await wipeLocalData(queryClient);
}

export async function wipeLocalData(queryClient: QueryClient): Promise<void> {
  const userId = useOutboxStore.getState().userId;
  // The server already dropped the subscription; this ends it in the browser.
  await unregisterPush().catch(() => {});
  lockPhotos();
  await clearLocalBiometrics().catch(() => {});
  useOutboxStore.setState({ items: [], sending: [] });
  if (userId) await offlineStorage.removeItem(`outbox:${userId}`).catch(() => {});
  await clearPersistedQueries();
  await offlineStorage.clear().catch(() => {});
  queryClient.clear();
  useWorkoutStore.getState().discard();
  useEditWorkoutStore.getState().discard();
  await wipeBrowserData();
  await getSupabase()
    .auth.signOut({ scope: 'local' })
    .catch(() => {});
}
