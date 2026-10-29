import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { isSupabaseConfigured } from '@/lib/env';
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

    // INITIAL_SESSION fires first with the session restored from storage.
    const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') queryClient.clear();
      setSession(session);
    });
    return () => data.subscription.unsubscribe();
  }, [setSession, queryClient]);
}
