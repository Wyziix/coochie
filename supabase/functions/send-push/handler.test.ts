// deno test supabase/functions. The push services are faked.
import { assertEquals } from 'jsr:@std/assert@1';

import { type Deps, handle, optionsFor, PARALLEL, type PushMessage } from './handler.ts';

const msg = (
  n: number,
  endpoint = `https://fcm.googleapis.com/fcm/send/${n}`,
  tag = `friend_request:${n}`,
): PushMessage => ({
  endpoint,
  p256dh: 'B'.repeat(87),
  auth: 'a'.repeat(22),
  title: 'New friend request',
  body: `user${n} wants to be friends.`,
  tag,
  data: { url: '/friends', notification_id: n },
});

function setup(messages: PushMessage[]) {
  const state = {
    claimed: 0,
    sent: [] as { endpoint: string; payload: unknown; ttl: number; urgency: string }[],
    forgotten: [] as string[],
    inFlight: 0,
    maxInFlight: 0,
  };
  const deps: Deps = {
    // deno-lint-ignore require-await
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      if (fn === 'push_forget') {
        state.forgotten.push(...(args.p_endpoints as string[]));
        return null as T;
      }
      if (fn !== 'push_claim' || args.p_token !== 'secret' || state.claimed)
        throw new Error('invalid or used run');
      state.claimed++;
      return messages as T;
    },
    async deliver(sub, payload, options) {
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await Promise.resolve();
      state.inFlight--;
      state.sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), ...options });
      if (sub.endpoint.includes('gone')) return 'gone';
      if (sub.endpoint.includes('broken')) throw new Error('network');
      return 'ok';
    },
  };
  return { deps, state };
}

const run = (token = 'secret') =>
  new Request('http://fn/send-push', {
    method: 'POST',
    body: JSON.stringify({ run_id: 'run-1', token }),
  });

Deno.test('sends every claimed message once, as the service worker expects it', async () => {
  const { deps, state } = setup([msg(1), msg(2)]);
  const res = await handle(run(), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { sent: 2, failed: 0, removed: 0 });
  assertEquals(state.sent[0]!.payload, {
    title: 'New friend request',
    body: 'user1 wants to be friends.',
    tag: 'friend_request:1',
    data: { url: '/friends', notification_id: 1 },
  });
  assertEquals(state.sent[0]!.urgency, 'normal');
});

Deno.test('the rest timer is urgent and short-lived', () => {
  assertEquals(optionsFor(msg(1, 'https://x', 'rest')), { ttl: 120, urgency: 'high' });
  assertEquals(optionsFor(msg(1)), { ttl: 86400, urgency: 'normal' });
});

Deno.test('gone subscriptions are removed; other failures are counted, not fatal', async () => {
  const { deps, state } = setup([
    msg(1, 'https://web.push.apple.com/gone-1'),
    msg(2, 'https://web.push.apple.com/gone-1'),
    msg(3, 'https://fcm.googleapis.com/fcm/send/broken'),
    msg(4),
  ]);
  assertEquals(await (await handle(run(), deps)).json(), { sent: 1, failed: 1, removed: 1 });
  assertEquals(state.forgotten, ['https://web.push.apple.com/gone-1']);
});

Deno.test(`at most ${PARALLEL} at a time`, async () => {
  const { deps, state } = setup(Array.from({ length: 45 }, (_, i) => msg(i)));
  assertEquals((await (await handle(run(), deps)).json()).sent, 45);
  assertEquals(state.maxInFlight <= PARALLEL, true);
});

Deno.test('only with the one-time token from pg_cron, once', async () => {
  const { deps, state } = setup([msg(1)]);
  assertEquals((await handle(run('guess'), deps)).status, 403);
  assertEquals((await handle(run(), deps)).status, 200);
  assertEquals((await handle(run(), deps)).status, 403);
  assertEquals(state.sent.length, 1);
});
