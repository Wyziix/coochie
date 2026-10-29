import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { readStoredSession } from '@/lib/auth/storedSession';
import { isSupabaseConfigured } from '@/lib/env';
import { clearPersistedQueries } from '@/lib/offline/cache';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

/** Keeps the auth store in sync with Supabase. Mount once at the root. */
export function useAuthListener() {
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(null);
      return;
    }

    // Offline with an expired token, Supabase keeps retrying the refresh for
    // up to ~30 s before INITIAL_SESSION. Don't make the gym wait: start with
    // the session stored on the device; Supabase's answer replaces it.
    let answered = false;
    readStoredSession().then((stored) => {
      if (!answered && stored) setSession(stored);
    });

    const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
      answered = true;
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
        clearPersistedQueries();
      }
      if (event === 'INITIAL_SESSION' && !session) {
        // The refresh failed for lack of a connection: the session is still
        // stored (a rejected one is deleted). Stay signed in; it refreshes once online.
        readStoredSession().then(setSession);
        return;
      }
      setSession(session);
    });
    return () => data.subscription.unsubscribe();
  }, [setSession, queryClient]);
}
