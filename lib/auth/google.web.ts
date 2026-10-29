import { getSupabase } from '@/lib/supabase';

import type { GoogleSignInResult } from './types';

/**
 * Web: full-page redirect to Google through Supabase. The browser comes back to
 * this origin with ?code=..., and the Supabase client finishes the sign-in.
 * A redirect (not a popup) also works inside an iPhone home-screen web app.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return 'redirecting';
}

export async function signOutOfGoogle(): Promise<void> {}
