// Android push for inbox notifications. pg_cron (social_tick, every 5 min)
// creates a run with a one-time token and POSTs { run_id, token } here; the
// run's messages are claimed (and marked sent) in the database. The inbox in
// the app works without this (iPhone web app, or before FCM is set up).
import { corsHeaders, json } from '../_shared/ai.ts';
import type { PushMessage } from '../weekly-report/handler.ts';

export type Deps = {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** Expo push; returns the tokens Expo says are no longer valid. */
  sendPush(messages: PushMessage[]): Promise<string[]>;
  deletePushTokens(tokens: string[]): Promise<void>;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method', message: 'Method not allowed' }, 405);
  const body = (await req.json().catch(() => null)) as { run_id?: string; token?: string } | null;
  let messages: PushMessage[];
  try {
    messages = await deps.rpc<PushMessage[]>('push_claim', {
      p_run: body?.run_id,
      p_token: body?.token,
    });
  } catch {
    return json({ error: 'forbidden', message: 'Invalid run.' }, 403);
  }
  let invalid: string[] = [];
  // Expo takes up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    invalid = invalid.concat(await deps.sendPush(messages.slice(i, i + 100)));
  }
  if (invalid.length) await deps.deletePushTokens(invalid);
  return json({ sent: messages.length, removed_tokens: invalid.length });
}
