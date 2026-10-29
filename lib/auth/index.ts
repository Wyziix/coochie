import { getSupabase } from '@/lib/supabase';

import { signOutOfGoogle } from './google';

export { isValidEmail, sendEmailCode, verifyEmailCode } from './email';
export { signInWithGoogle } from './google';
export type { GoogleSignInResult } from './types';

export async function signOut(): Promise<void> {
  await signOutOfGoogle();
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}
