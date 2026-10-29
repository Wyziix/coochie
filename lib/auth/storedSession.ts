import type { Session } from '@supabase/supabase-js';

import { env } from '@/lib/env';

import { sessionStorage } from './sessionStorage';

/**
 * The session as Supabase saved it on the device. Used when the app opens
 * offline with an expired access token: Supabase can't refresh it then and
 * reports no session, but the user is still signed in (it refreshes as soon
 * as there's a connection). A session Supabase rejected is deleted, so it's
 * never found here.
 */
export async function readStoredSession(): Promise<Session | null> {
  try {
    const ref = new URL(env.supabaseUrl).hostname.split('.')[0];
    const raw = await sessionStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return session?.user?.id && session.refresh_token ? session : null;
  } catch {
    return null;
  }
}
