import { resetLock } from '@/lib/api/photoLock';
import { signInWithGoogle } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export const WRONG_ACCOUNT =
  'That Google account belongs to a different LightweightBaby account. Sign in again with the account the photos belong to.';

// The Google sign-in leaves the page, so remember (for this tab only) that a
// reset was asked for, and by which account.
const KEY = 'lightweightbaby.photo-reset';

function read() {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Forgot PIN (web): full-page Google sign-in; finishPendingReset() runs when it comes back. */
export async function resetWithGoogle(): Promise<'done' | 'cancelled' | 'redirecting'> {
  const userId = (await getSupabase().auth.getSession()).data.session?.user.id;
  try {
    if (userId) window.sessionStorage.setItem(KEY, userId);
  } catch {
    throw new Error('This browser blocks storage, so the reset can’t continue after signing in.');
  }
  return (await signInWithGoogle()) === 'redirecting' ? 'redirecting' : 'cancelled';
}

export async function finishPendingReset(userId: string): Promise<'done' | 'none'> {
  const expected = read();
  if (!expected) return 'none';
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clean up
  }
  if (expected !== userId) throw new Error(WRONG_ACCOUNT);
  await resetLock();
  return 'done';
}
