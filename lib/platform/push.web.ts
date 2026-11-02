// Web push for the installed app: Android Chrome, desktop browsers, and
// iPhone home-screen apps (iOS 16.4+; Safari tabs can't get push).
// - The permission prompt only ever comes from enablePush(), called from a tap.
// - registerPush() on start only refreshes an existing subscription.
// - The service worker (scripts/sw.template.js) shows the notifications.
// The inbox in the app works without any of this.
import { deleteWebPush, saveWebPush } from '@/lib/api/push';
import { env } from '@/lib/env';

import { isIos, isStandalone } from './pwa';

export type PushState = 'unsupported' | 'needs_install' | 'denied' | 'off' | 'on';

const hasApis = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** base64url (the VAPID public key) → bytes for pushManager.subscribe. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const b64url = (buf: ArrayBuffer | null) =>
  buf
    ? btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    : '';

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!hasApis()) return null;
  // ready never resolves without a service worker (dev builds): don't wait forever.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), 4000);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function subscribeAndSave(reg: ServiceWorkerRegistration): Promise<boolean> {
  let sub = await reg.pushManager.getSubscription();
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(env.vapidPublicKey),
  });
  await saveWebPush({
    endpoint: sub.endpoint,
    p256dh: b64url(sub.getKey('p256dh')),
    auth: b64url(sub.getKey('auth')),
  });
  return true;
}

export async function pushState(): Promise<PushState> {
  // iPhone: only the home-screen app has push (Safari tabs don't).
  if (isIos() && !isStandalone()) return 'needs_install';
  if (!hasApis() || !env.vapidPublicKey) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** Call straight from a tap: asks for permission, subscribes, tells the server. */
export async function enablePush(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'needs_install';
  if (!hasApis() || !env.vapidPublicKey) return 'unsupported';
  // First thing in the tap handler, so the browser counts it as the user's action.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const reg = await registration();
  if (!reg) return 'unsupported';
  await subscribeAndSave(reg);
  return 'on';
}

/** Turn off on this device (the inbox keeps working). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await deleteWebPush(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}

/**
 * On start (signed in): keeps an existing subscription tied to this user.
 * Never asks for permission.
 */
export async function registerPush(): Promise<boolean> {
  if (!hasApis() || !env.vapidPublicKey || Notification.permission !== 'granted') return false;
  if (isIos() && !isStandalone()) return false;
  const reg = await registration();
  if (!reg || !(await reg.pushManager.getSubscription())) return false;
  return subscribeAndSave(reg);
}

/** On logout: the next person on this device doesn't get your notifications. */
export async function unregisterPush(): Promise<void> {
  await disablePush();
}

export async function pushIsOn(): Promise<boolean> {
  if (!hasApis() || Notification.permission !== 'granted') return false;
  return !!(await currentSubscription().catch(() => null));
}

/** A tapped notification while the app was already open (the service worker posts it). */
export function onNotificationTap(open: (url: string) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type === 'OPEN_URL' && typeof data.url === 'string' && data.url.startsWith('/')) {
      open(data.url);
    }
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
