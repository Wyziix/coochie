import { getSupabase } from '@/lib/supabase';

/** 'setup' = never chose a lock; 'none' = removed on purpose. */
export type LockState = 'setup' | 'pin' | 'password' | 'none';
export type LockKind = 'pin' | 'password';

export type LockStatus = {
  state: LockState;
  /** Set while locked out after 5 wrong attempts. */
  locked_until: string | null;
  attempts_left: number | null;
  photo_count: number;
  devices: number;
};

export type Unlocked = { ok: true; token: string; expires_at: string };
/** Wrong secret, locked out, or not set up. Checked and counted on the server. */
export type Refused =
  | { ok: false; reason: 'wrong'; attempts_left: number }
  | { ok: false; reason: 'locked'; locked_until: string }
  | { ok: false; reason: 'setup' };
export type UnlockResult = Unlocked | Refused;
export type CheckResult = { ok: true } | Refused;

export const PIN_PATTERN = /^[0-9]{4,6}$/;

/** Same rules as the server; returns an error message or null. */
export function validateSecret(kind: LockKind, secret: string): string | null {
  if (kind === 'pin') return PIN_PATTERN.test(secret) ? null : 'PIN must be 4 to 6 digits.';
  if (secret.length < 6) return 'Password must be at least 6 characters.';
  if (new TextEncoder().encode(secret).length > 72) return 'Password is too long.';
  return null;
}

export async function fetchLockStatus(): Promise<LockStatus> {
  const { data, error } = await getSupabase().rpc('photo_lock_status');
  if (error) throw error;
  return data as unknown as LockStatus;
}

export async function setupLock(kind: LockKind, secret: string): Promise<Unlocked> {
  const { data, error } = await getSupabase().rpc('photo_setup', {
    p_kind: kind,
    p_secret: secret,
  });
  if (error) throw error;
  return data as unknown as Unlocked;
}

export async function unlockPhotos(
  input: { secret: string } | { deviceKey: string } | Record<string, never>,
): Promise<UnlockResult> {
  const { data, error } = await getSupabase().rpc('photo_unlock', {
    p_secret: 'secret' in input ? input.secret : null,
    p_device_key: 'deviceKey' in input ? input.deviceKey : null,
  });
  if (error) throw error;
  return data as unknown as UnlockResult;
}

export async function relockPhotos(token: string): Promise<void> {
  const { error } = await getSupabase().rpc('photo_relock', { p_token: token });
  if (error) throw error;
}

export async function changeLockSecret(
  current: string,
  kind: LockKind,
  secret: string,
): Promise<CheckResult> {
  const { data, error } = await getSupabase().rpc('photo_change_secret', {
    p_current: current,
    p_kind: kind,
    p_secret: secret,
  });
  if (error) throw error;
  return data as unknown as CheckResult;
}

export async function removeLock(current: string): Promise<CheckResult> {
  const { data, error } = await getSupabase().rpc('photo_remove_secret', { p_current: current });
  if (error) throw error;
  return data as unknown as CheckResult;
}

/** Only works right after a Google sign-in (checked on the server). Photos are kept. */
export async function resetLock(): Promise<void> {
  const { error } = await getSupabase().rpc('photo_reset_lock');
  if (error) throw error;
}

export async function registerDevice(
  token: string,
  name: string,
): Promise<{ id: string; key: string }> {
  const { data, error } = await getSupabase().rpc('photo_register_device', {
    p_token: token,
    p_name: name,
  });
  if (error) throw error;
  return data as unknown as { id: string; key: string };
}

export async function forgetDevice(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('photo_forget_device', { p_id: id });
  if (error) throw error;
}

/** Human message for a refused unlock / change. */
export function refusedMessage(result: Refused, kind: LockKind | null, now = Date.now()): string {
  const what = kind === 'password' ? 'password' : 'PIN';
  if (result.reason === 'locked') {
    const minutes = Math.max(1, Math.ceil((Date.parse(result.locked_until) - now) / 60_000));
    return `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  if (result.reason === 'setup') return 'Set up a photo lock first.';
  return `Wrong ${what}. ${result.attempts_left} attempt${result.attempts_left === 1 ? '' : 's'} left before a 15-minute lock.`;
}
