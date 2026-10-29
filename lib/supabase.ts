import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/types/database';

import { sessionStorage } from './auth/sessionStorage';
import { env, isSupabaseConfigured } from './env';

let client: SupabaseClient<Database> | null = null;

// Created lazily so the app can boot (and tests can run) before Supabase keys
// are set. Anything that talks to the backend should call this.
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  client = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      // Encrypted with a key in SecureStore on native; localStorage on web.
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Web signs in with a Google redirect that comes back with ?code=...,
      // which the client exchanges for a session (PKCE). Native uses ID tokens.
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  });

  // Refresh tokens only while the app is in the foreground.
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') client?.auth.startAutoRefresh();
      else client?.auth.stopAutoRefresh();
    });
  }

  return client;
}
