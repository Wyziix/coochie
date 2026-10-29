import { resetLock } from '@/lib/api/photoLock';
import { signInWithGoogle } from '@/lib/auth';
import { signOutOfGoogle } from '@/lib/auth/google';
import { getSupabase } from '@/lib/supabase';

import { clearLocalBiometrics } from './biometrics';

export const WRONG_ACCOUNT =
  'That Google account belongs to a different LightweightBaby account. Sign in again with the account the photos belong to.';

async function currentUserId() {
  return (await getSupabase().auth.getSession()).data.session?.user.id ?? null;
}

/**
 * Forgot PIN (Android): sign in with Google again, then reset. The server
 * only accepts the reset right after a Google sign-in. Photos are kept.
 */
export async function resetWithGoogle(): Promise<'done' | 'cancelled' | 'redirecting'> {
  const before = await currentUserId();
  await signOutOfGoogle(); // so Google shows the account picker instead of reusing the session
  const result = await signInWithGoogle();
  if (result !== 'signed-in') return 'cancelled';
  if (before && (await currentUserId()) !== before) throw new Error(WRONG_ACCOUNT);
  await resetLock();
  await clearLocalBiometrics();
  return 'done';
}

/** Web only: finishes a reset after the Google redirect. */
export async function finishPendingReset(_userId: string): Promise<'done' | 'none'> {
  return 'none';
}
