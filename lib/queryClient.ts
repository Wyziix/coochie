import { QueryClient } from '@tanstack/react-query';

import { fetchLastSets } from './api/exercises';
import { describeError } from './errors';

/** Retry only what can fix itself: a dropped connection or a server hiccup, once. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const { kind } = describeError(error);
  if (kind === 'missing' || kind === 'permission' || kind === 'session') return false;
  return failureCount < 1;
}

export function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        // Kept (and saved on the device) for a week, so the app has data offline.
        gcTime: 7 * 24 * 60 * 60 * 1000,
        retry: shouldRetry,
      },
      // Saves go to the sync queue on the device, so they must run offline too
      // (not pause). Online-only actions then fail fast with "No connection".
      mutations: { networkMode: 'always' },
    },
  });
  // "Last time" sets are cached one exercise at a time, some filled in bulk for
  // offline use; this lets any of them refetch.
  client.setQueryDefaults(['last-sets'], {
    queryFn: ({ queryKey }) => fetchLastSets([String(queryKey[1])]),
  });
  return client;
}
