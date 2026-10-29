import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { forgetDevice, registerDevice } from '@/lib/api/photoLock';

// Fingerprint / face unlock: the server gives this phone a random device key
// (not the PIN). It's kept in the Android keystore and can only be read after
// a biometric check. Removing the lock or resetting it revokes the key.
const KEY = 'photo-lock.device-key';
const ID = 'photo-lock.device-id';

export async function biometricsSupported(): Promise<boolean> {
  try {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}

/** "fingerprint", "face" or "fingerprint or face", for labels. */
export async function biometricsLabel(): Promise<string> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync().catch(
    (): LocalAuthentication.AuthenticationType[] => [],
  );
  const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  if (finger && face) return 'fingerprint or face';
  return face ? 'face' : 'fingerprint';
}

export async function isBiometricsEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ID).catch(() => null)) != null;
}

/** Needs an unlock token (the PIN was just entered). Shows the biometric prompt. */
export async function enableBiometrics(token: string): Promise<void> {
  const { id, key } = await registerDevice(
    token,
    Platform.OS === 'android' ? 'Android phone' : 'Phone',
  );
  try {
    await SecureStore.setItemAsync(KEY, key, {
      requireAuthentication: true,
      authenticationPrompt: 'Confirm to turn on biometric unlock',
    });
    await SecureStore.setItemAsync(ID, id);
  } catch (error) {
    await forgetDevice(id).catch(() => {});
    throw error;
  }
}

/** Shows the biometric prompt. Null if cancelled or the key is gone (new fingerprint added). */
export async function readDeviceKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY, {
      requireAuthentication: true,
      authenticationPrompt: 'Unlock progress photos',
    });
  } catch {
    return null;
  }
}

/** Only this phone's copy; the server side is gone already (reset, lock removed). */
export async function clearLocalBiometrics(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
  await SecureStore.deleteItemAsync(ID).catch(() => {});
}

export async function disableBiometrics(): Promise<void> {
  const id = await SecureStore.getItemAsync(ID).catch(() => null);
  if (id) await forgetDevice(id).catch(() => {});
  await clearLocalBiometrics();
}
