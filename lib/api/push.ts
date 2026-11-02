import { env } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';

/** This browser's web push subscription, for the signed-in user. */
export async function saveWebPush(sub: { endpoint: string; p256dh: string; auth: string }) {
  const { error } = await getSupabase().rpc('save_web_push', {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
    p_user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 200),
  });
  if (error) throw error;
}

export async function deleteWebPush(endpoint: string) {
  const { error } = await getSupabase().rpc('delete_web_push', { p_endpoint: endpoint });
  if (error) throw error;
}

/**
 * Rest timer push. Sent with fetch keepalive, so it still goes out when the
 * app is being put in the background (that's exactly when it's needed).
 */
export async function callPushRpc(
  fn: 'schedule_push' | 'cancel_push',
  args: Record<string, unknown>,
): Promise<boolean> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: env.supabasePublishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return false;
  return fn === 'schedule_push' ? (await res.json().catch(() => false)) === true : true;
}
