import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { env } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';

import type { GoogleSignInResult } from './types';

let configured = false;

function configure() {
  if (configured) return;
  if (!env.googleWebClientId) {
    throw new Error('Google sign-in is not configured (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).');
  }
  GoogleSignin.configure({
    // The web client ID makes Google return an ID token Supabase can verify.
    webClientId: env.googleWebClientId,
    iosClientId: env.googleIosClientId || undefined,
  });
  configured = true;
}

/** Native Google sign-in (Android, iOS dev builds) → Supabase session via ID token. */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  configure();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return 'cancelled';

    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google did not return an ID token.');

    const { error } = await getSupabase().auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error) throw error;
    return 'signed-in';
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS) {
        return 'cancelled';
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play Services is missing or out of date.');
      }
    }
    throw error;
  }
}

export async function signOutOfGoogle(): Promise<void> {
  if (!configured) return;
  await GoogleSignin.signOut().catch(() => {});
}
