import { useEffect, useState } from 'react';

import { isUsernameAvailable } from '@/lib/api/profiles';
import { normalizeUsername, validateUsername } from '@/lib/profile/validation';

export type UsernameStatus =
  | { state: 'idle' | 'checking' | 'available' }
  | { state: 'invalid' | 'taken' | 'error'; message: string };

/**
 * Validates locally, then asks the server (debounced) whether the name is free.
 * `current` is the user's existing username, which always counts as available.
 */
export function useUsernameCheck(input: string, current?: string | null, delayMs = 400) {
  const [status, setStatus] = useState<UsernameStatus>({ state: 'idle' });
  const name = normalizeUsername(input);

  useEffect(() => {
    if (!name) return setStatus({ state: 'idle' });
    const invalid = validateUsername(name);
    if (invalid) return setStatus({ state: 'invalid', message: invalid });
    if (current && name === current) return setStatus({ state: 'available' });

    let cancelled = false;
    setStatus({ state: 'checking' });
    const timer = setTimeout(() => {
      isUsernameAvailable(name)
        .then((free) => {
          if (cancelled) return;
          setStatus(
            free ? { state: 'available' } : { state: 'taken', message: 'That username is taken' },
          );
        })
        .catch(() => {
          if (!cancelled) setStatus({ state: 'error', message: 'Couldn’t check right now' });
        });
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, current, delayMs]);

  return status;
}
