import type { PushMessage } from '../weekly-report/handler.ts';

/**
 * Sends through Expo's push service (Android app). Returns tokens Expo says
 * are no longer registered, so they can be removed.
 */
export async function sendExpoPush(messages: PushMessage[]): Promise<string[]> {
  if (messages.length === 0) return [];
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages.map((m) => ({ ...m, sound: 'default', channelId: 'reports' }))),
  });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as {
    data?: { status: string; details?: { error?: string } }[];
  } | null;
  return (body?.data ?? [])
    .map((ticket, i) => (ticket.details?.error === 'DeviceNotRegistered' ? messages[i]!.to : null))
    .filter((t): t is string => t !== null);
}
