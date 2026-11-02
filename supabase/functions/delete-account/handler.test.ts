// deno test supabase/functions. Auth, database and storage are faked.
import { assertEquals } from 'jsr:@std/assert@1';

import { type Deps, handle } from './handler.ts';

const USER = 'aaaa0000-0000-0000-0000-000000000001';
const NOW = new Date('2026-11-02T18:00:00Z');

function setup(
  opts: { signedInMinutesAgo?: number | null; lastAdmin?: boolean; failRemove?: boolean } = {},
) {
  const ago = opts.signedInMinutesAgo === undefined ? 2 : opts.signedInMinutesAgo;
  const state = {
    steps: [] as string[],
    files: {
      avatars: [`${USER}/avatar.jpg`, 'someone-else/avatar.jpg'],
      'progress-photos': Array.from({ length: 150 }, (_, i) => `${USER}/p${i}.jpg`),
    } as Record<string, string[]>,
  };
  const deps: Deps = {
    session: (a) =>
      Promise.resolve(
        a === 'Bearer user-jwt'
          ? {
              userId: USER,
              signedInAt: ago === null ? null : new Date(NOW.getTime() - ago * 60_000),
            }
          : null,
      ),
    rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      if (args.p_user !== USER) throw new Error('wrong user');
      if (fn === 'account_for_delete') {
        return Promise.resolve({
          username: 'gleb_k',
          role: opts.lastAdmin ? 'admin' : 'user',
          last_admin: !!opts.lastAdmin,
        } as T);
      }
      if (fn === 'delete_user_data') {
        const left = Object.values(state.files)
          .flat()
          .filter((p) => p.startsWith(`${USER}/`));
        if (left.length) return Promise.reject(new Error('delete_user_data: storage files left'));
        state.steps.push('rows');
        return Promise.resolve({ label: 'deleted-user-1234abcd' } as T);
      }
      throw new Error(`unexpected ${fn}`);
    },
    storage: {
      list: (bucket, folder) =>
        Promise.resolve((state.files[bucket] ?? []).filter((p) => p.startsWith(`${folder}/`))),
      remove(bucket, paths) {
        if (opts.failRemove) return Promise.reject(new Error('storage down'));
        if (paths.length > 100) throw new Error('too many at once');
        state.files[bucket] = state.files[bucket]!.filter((p) => !paths.includes(p));
        state.steps.push(`remove ${bucket} ${paths.length}`);
        return Promise.resolve();
      },
    },
    deleteAuthUser(id) {
      state.steps.push(`auth ${id}`);
      return Promise.resolve();
    },
    now: () => NOW,
  };
  return { deps, state };
}

const post = (body: unknown, auth = 'Bearer user-jwt') =>
  new Request('http://fn/delete-account', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

Deno.test('deletes files, then every row, then the auth user', async () => {
  const { deps, state } = setup();
  const res = await handle(post({ username: '  Gleb_K ' }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true });
  assertEquals(state.steps, [
    'remove avatars 1',
    'remove progress-photos 100',
    'remove progress-photos 50',
    'rows',
    `auth ${USER}`,
  ]);
  assertEquals(state.files.avatars, ['someone-else/avatar.jpg'], 'other people’s files stay');
});

Deno.test('needs a sign-in from the last 10 minutes', async () => {
  for (const ago of [11, null]) {
    const { deps, state } = setup({ signedInMinutesAgo: ago });
    const res = await handle(post({ username: 'gleb_k' }), deps);
    assertEquals(res.status, 403);
    assertEquals((await res.json()).error, 'reauth');
    assertEquals(state.steps, []);
  }
  assertEquals(
    (await handle(post({ username: 'gleb_k' }), setup({ signedInMinutesAgo: 9 }).deps)).status,
    200,
  );
});

Deno.test('the typed username must match', async () => {
  for (const username of ['gleb', '', undefined, 'gleb_k2']) {
    const { deps, state } = setup();
    const res = await handle(post({ username }), deps);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'confirm');
    assertEquals(state.steps, []);
  }
});

Deno.test('the last admin can’t be deleted', async () => {
  const { deps, state } = setup({ lastAdmin: true });
  const res = await handle(post({ username: 'gleb_k' }), deps);
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'last_admin');
  assertEquals(state.steps, []);
});

Deno.test('a storage failure stops before any row is deleted', async () => {
  const { deps, state } = setup({ failRemove: true });
  const res = await handle(post({ username: 'gleb_k' }), deps);
  assertEquals(res.status, 500);
  assertEquals(state.steps, []);
});

Deno.test('not signed in, wrong method', async () => {
  assertEquals(
    (await handle(post({ username: 'gleb_k' }, 'Bearer nope'), setup().deps)).status,
    401,
  );
  assertEquals(
    (await handle(new Request('http://fn', { method: 'GET' }), setup().deps)).status,
    405,
  );
});
