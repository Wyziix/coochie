// Web: PIN or password only.
export async function biometricsSupported(): Promise<boolean> {
  return false;
}

export async function biometricsLabel(): Promise<string> {
  return 'fingerprint';
}

export async function isBiometricsEnabled(): Promise<boolean> {
  return false;
}

export async function enableBiometrics(_token: string): Promise<void> {
  throw new Error('Biometric unlock is only available in the Android app.');
}

export async function readDeviceKey(): Promise<string | null> {
  return null;
}

export async function clearLocalBiometrics(): Promise<void> {}

export async function disableBiometrics(): Promise<void> {}
