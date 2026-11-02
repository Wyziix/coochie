// deno test supabase/functions. Expo push is faked.
import { assertEquals } from 'jsr:@std/assert@1';

import type { PushMessage } from '../weekly-report/handler.ts';
import { type Deps, handle } from './handler.ts';

const msg = (n: number, token = `ExponentPushToken[${n}]`): PushMessage => ({
  to: token,
  title: 'New friend request',
  body: `user${n} wants to be friends.`,
  data: { url: '/friends' },
});

function setup(messages: PushMessage[]) {
  const state = { claimed: 0, batches: [] as number[], deleted: [] as string[] };
  const deps: Deps = {
    // deno-lint-ignore require-await
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      if (fn !== 'push_claim' || args.p_token !== 'secret' || state.claimed)
        throw new Error('invalid or used run');
      state.claimed++;
      return messages as T;
    },
    // deno-lint-ignore require-await
    async sendPush(batch) {
      state.batches.push(batch.length);
      return batch.filter((m) => m.to.includes('gone')).map((m) => m.to);
    },
    // deno-lint-ignore require-await
    async deletePushTokens(tokens) {
      state.deleted.push(...tokens);
    },
  };
  return { deps, state };
}

const post = (token: string) =>
  new Request('http://fn/send-push', {
    method: 'POST',
    body: JSON.stringify({ run_id: 'r1', token }),
  });

Deno.test('sends the claimed messages in batches of 100 and removes dead tokens', async () => {
  const messages = [
    ...Array.from({ length: 150 }, (_, i) => msg(i)),
    msg(999, 'ExponentPushToken[gone]'),
  ];
  const { deps, state } = setup(messages);
  const res = await handle(post('secret'), deps);
  assertEquals(await res.json(), { sent: 151, removed_tokens: 1 });
  assertEquals(state.batches, [100, 51]);
  assertEquals(state.deleted, ['ExponentPushToken[gone]']);
});

Deno.test('only with the one-time token from the database, once', async () => {
  const { deps, state } = setup([msg(1)]);
  assertEquals((await handle(post('guess'), deps)).status, 403);
  assertEquals((await handle(post('secret'), deps)).status, 200);
  assertEquals((await handle(post('secret'), deps)).status, 403);
  assertEquals(state.batches, [1]);
});

Deno.test('nothing to send', async () => {
  const { deps, state } = setup([]);
  assertEquals(await (await handle(post('secret'), deps)).json(), { sent: 0, removed_tokens: 0 });
  assertEquals(state.batches, []);
});
