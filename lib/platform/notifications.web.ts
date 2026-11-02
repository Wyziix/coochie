// Web (incl. the iPhone home-screen app): no local notifications, so the rest
// timer uses a server push (schedule_push) when web push is on. It is only
// scheduled while the app is in the background: going back to the app cancels
// it (the in-app sound + vibration play instead), leaving reschedules it.
import { callPushRpc } from '@/lib/api/push';

import { pushIsOn } from './push';

export const supportsLocalNotifications = false;

const TAG = 'rest';
let pending: { endsAt: number; exerciseName: string } | null = null;
let scheduled = false;
let listening = false;

function schedule() {
  if (!pending) return;
  const seconds = Math.round((pending.endsAt - Date.now()) / 1000);
  if (seconds < 5) return;
  scheduled = true;
  callPushRpc('schedule_push', {
    p_tag: TAG,
    p_seconds: Math.min(seconds, 1800),
    p_title: 'Rest is over',
    p_body: `Next set: ${pending.exerciseName}`,
  }).catch(() => {});
}

function cancel() {
  if (!scheduled) return;
  scheduled = false;
  callPushRpc('cancel_push', { p_tag: TAG }).catch(() => {});
}

function onVisibility() {
  if (document.visibilityState === 'hidden') schedule();
  else cancel();
}

export async function ensureNotificationPermission(): Promise<boolean> {
  return pushIsOn();
}

/** Remembers the rest end; the push is sent only if the app goes to the background. */
export async function scheduleRestNotification(
  seconds: number,
  exerciseName: string,
): Promise<string | null> {
  if (seconds <= 0 || typeof document === 'undefined') return null;
  if (!(await pushIsOn())) return null;
  pending = { endsAt: Date.now() + seconds * 1000, exerciseName };
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', onVisibility);
  }
  if (document.visibilityState === 'hidden') schedule();
  return TAG;
}

export async function cancelRestNotification(id?: string | null): Promise<void> {
  if (!id) return;
  pending = null;
  cancel();
}
