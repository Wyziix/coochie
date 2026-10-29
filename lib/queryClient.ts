import { QueryClient } from '@tanstack/react-query';

import { describeError } from './errors';

/** Retry only what can fix itself: a dropped connection or a server hiccup, once. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const { kind } = describeError(error);
  if (kind === 'missing' || kind === 'permission' || kind === 'session') return false;
  return failureCount < 1;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: shouldRetry,
      },
    },
  });
}
