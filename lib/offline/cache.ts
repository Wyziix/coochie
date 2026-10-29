import type { QueryClient } from '@tanstack/react-query';
import {
  persistQueryClient,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client';

import {
  fetchExercises,
  fetchLastSets,
  fetchRecentExerciseIds,
  fetchRestSettings,
} from '@/lib/api/exercises';
import { fetchTemplates } from '@/lib/api/templates';
import { fetchRecentWorkouts, fetchWorkoutsPage } from '@/lib/api/workouts';

import { offlineStorage } from './storage';

// The query cache is saved on the device so the app opens with data when
// offline. Only one user's cache is kept: it's tagged with their id and thrown
// away on sign-out or if someone else signs in.
const KEY = 'query-cache';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

/** Never stored: photos (signed URLs, behind the PIN), the lock, admin data, AI calls left. */
const NOT_STORED = new Set(['photos', 'photo-lock', 'admin', 'admin-actions', 'ai-status']);

let timer: ReturnType<typeof setTimeout> | null = null;
let latest: PersistedClient | null = null;

const persister: Persister = {
  // Saved at most once a second.
  persistClient(client) {
    latest = client;
    timer ??= setTimeout(() => {
      timer = null;
      const snapshot = latest;
      latest = null;
      if (snapshot) offlineStorage.setItem(KEY, JSON.stringify(snapshot)).catch(() => {});
    }, 1000);
  },
  async restoreClient() {
    const raw = await offlineStorage.getItem(KEY).catch(() => null);
    return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
  },
  async removeClient() {
    if (timer) clearTimeout(timer);
    timer = null;
    latest = null;
    await offlineStorage.removeItem(KEY).catch(() => {});
  },
};

/** Restores this user's cached data, then keeps saving it. Returns [stop, restored]. */
export function startQueryPersistence(queryClient: QueryClient, userId: string) {
  return persistQueryClient({
    queryClient,
    persister,
    buster: `v1:${userId}`,
    maxAge: MAX_AGE,
    dehydrateOptions: {
      shouldDehydrateQuery: (q) =>
        q.state.status === 'success' && !NOT_STORED.has(String(q.queryKey[0])),
    },
  });
}

export const clearPersistedQueries = () => persister.removeClient();

/**
 * Write the latest snapshot now instead of within the second: before synced
 * changes leave the queue, and when the app goes to the background (it may be
 * closed right after).
 */
export async function flushPersistedQueries() {
  if (timer) clearTimeout(timer);
  timer = null;
  const snapshot = latest;
  latest = null;
  if (snapshot) await offlineStorage.setItem(KEY, JSON.stringify(snapshot)).catch(() => {});
}

/**
 * While online, load what the gym needs offline: exercise library, templates,
 * recent workouts and history, rest times, and last time's sets for the
 * exercises in recent workouts and templates.
 */
export async function warmOfflineCache(queryClient: QueryClient) {
  const prefetch = <T>(queryKey: unknown[], queryFn: () => Promise<T>) =>
    queryClient.prefetchQuery({ queryKey, queryFn, staleTime: 5 * 60_000 });
  await Promise.all([
    prefetch(['exercises'], fetchExercises),
    prefetch(['templates'], fetchTemplates),
    prefetch(['rest-settings'], fetchRestSettings),
    prefetch(['workouts', 'recent', 5], () => fetchRecentWorkouts(5)),
    prefetch(['recent-exercises'], () => fetchRecentExerciseIds()),
    queryClient.prefetchInfiniteQuery({
      queryKey: ['workouts', 'history'],
      queryFn: ({ pageParam }) => fetchWorkoutsPage(pageParam as number, 20),
      initialPageParam: 0,
      staleTime: 5 * 60_000,
    }),
  ]);

  const ids = new Set<string>(queryClient.getQueryData<string[]>(['recent-exercises']) ?? []);
  const templates = queryClient.getQueryData<Awaited<ReturnType<typeof fetchTemplates>>>([
    'templates',
  ]);
  for (const t of templates ?? []) for (const e of t.exercises) ids.add(e.exercise_id);
  const missing = [...ids].filter((id) => !queryClient.getQueryData(['last-sets', id]));
  if (missing.length === 0) return;
  const rows = await fetchLastSets(missing);
  for (const id of missing) {
    queryClient.setQueryData(
      ['last-sets', id],
      rows.filter((r) => r.exercise_id === id),
    );
  }
}
