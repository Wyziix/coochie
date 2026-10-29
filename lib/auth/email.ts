import { Platform } from 'react-native';

import { getSupabase } from '@/lib/supabase';

export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/** Turns Supabase auth errors into something a person can act on. */
function friendlyError(error: { status?: number; message: string }): Error {
  if (error.status === 429)
    return new Error('Too many attempts. Wait a few minutes and try again.');
  if (/expired|invalid/i.test(error.message))
    return new Error('That code is wrong or has expired.');
  return new Error(error.message);
}

/**
 * Emails a one-time code (and a magic link). The code is what makes this work
 * in an iPhone home-screen app: a link from Mail opens in Safari, which
 * doesn't share storage with the installed web app, but a typed code does.
 */
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
      // Web: the link brings you back here (same browser) and signs you in.
      emailRedirectTo: Platform.OS === 'web' ? window.location.origin : undefined,
    },
  });
  if (error) throw friendlyError(error);
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw friendlyError(error);
}
