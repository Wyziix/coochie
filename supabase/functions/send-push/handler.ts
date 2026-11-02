// Web push for inbox notifications and the rest timer. pg_cron (push_due,
// every 10 seconds) creates a run with a one-time token and POSTs
// { run_id, token } here; the run's messages are claimed (and marked sent) in
// the database. Subscriptions the push service says are gone are removed.
// The inbox in the app works without this.
import { corsHeaders, json } from '../_shared/ai.ts';

export type PushMessage = {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  tag: string;
  data: Record<string, unknown>;
};

export type Delivery = 'ok' | 'gone' | 'error';

export type Deps = {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** Encrypts and sends one message (RFC 8291) with the VAPID key. */
  deliver(
    subscription: { endpoint: string; p256dh: string; auth: string },
    payload: string,
    options: { ttl: number; urgency: 'normal' | 'high' },
  ): Promise<Delivery>;
};

/** Sent at the same time, at most. */
export const PARALLEL = 20;

/** What the service worker shows (see scripts/sw.template.js). */
export function payloadFor(m: PushMessage): string {
  return JSON.stringify({ title: m.title, body: m.body, tag: m.tag, data: m.data ?? {} });
}

/** Rest timer: urgent, useless after 2 minutes. Inbox entries: within a day. */
export function optionsFor(m: PushMessage): { ttl: number; urgency: 'normal' | 'high' } {
  return m.tag.startsWith('rest')
    ? { ttl: 120, urgency: 'high' }
    : { ttl: 86400, urgency: 'normal' };
}

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
  const results: Delivery[] = [];
  for (let i = 0; i < messages.length; i += PARALLEL) {
    const batch = messages.slice(i, i + PARALLEL);
    results.push(
      ...(await Promise.all(
        batch.map((m) =>
          deps.deliver(m, payloadFor(m), optionsFor(m)).catch((): Delivery => 'error'),
        ),
      )),
    );
  }
  const gone = [
    ...new Set(messages.filter((_, i) => results[i] === 'gone').map((m) => m.endpoint)),
  ];
  if (gone.length) await deps.rpc('push_forget', { p_endpoints: gone }).catch(() => {});
  return json({
    sent: results.filter((r) => r === 'ok').length,
    failed: results.filter((r) => r === 'error').length,
    removed: gone.length,
  });
}
