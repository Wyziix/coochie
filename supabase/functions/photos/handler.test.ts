// deno test supabase/functions (npm run test:functions)
// The fake database follows the SQL (photo_lock.test.sql proves the real one):
// a token only works for the user it was issued to, until it expires.
import { assert, assertEquals } from 'jsr:@std/assert@1';

import { type Deps, handle, MAX_URL_TTL, type RpcResult } from './handler.ts';

const ALICE = 'aaaa0000-0000-0000-0000-000000000001';
const BOB = 'aaaa0000-0000-0000-0000-000000000002';
const NOW = Date.parse('2026-10-29T12:00:00Z');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function setup() {
  const tokens = new Map<string, { user: string; expires: number }>([
    ['alice-token', { user: ALICE, expires: NOW + 4 * 60_000 }],
    ['alice-old', { user: ALICE, expires: NOW - 1 }],
    ['bob-token', { user: BOB, expires: NOW + 60_000 }],
  ]);
  const photos = [
    { id: 'p-alice', user_id: ALICE, storage_path: `${ALICE}/p-alice.jpg` },
    { id: 'bbbb0000-0000-0000-0000-00000000000b', user_id: BOB, storage_path: `${BOB}/p-bob.jpg` },
  ];
  const calls = {
    rpc: [] as string[],
    sign: [] as [string[], number][],
    upload: [] as string[],
    remove: [] as string[][],
  };
  let failAdd = false;

  const locked: RpcResult = {
    data: null,
    error: { message: 'Photos are locked', code: 'PT403' },
    status: 403,
  };
  const deps: Deps = {
    userDb(authorization) {
      const user =
        authorization === 'Bearer alice-jwt'
          ? ALICE
          : authorization === 'Bearer bob-jwt'
            ? BOB
            : null;
      return {
        // deno-lint-ignore require-await
        async rpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
          calls.rpc.push(fn);
          if (!user) return { data: null, error: { message: 'JWT invalid' }, status: 401 };
          const t = tokens.get(String(args.p_token));
          if (!t || t.user !== user || t.expires <= NOW) return locked as RpcResult<T>;
          const ok = (data: unknown) => ({ data: data as T, error: null, status: 200 });
          switch (fn) {
            case 'photo_session':
              return ok({ user_id: user, expires_at: new Date(t.expires).toISOString() });
            case 'photo_list':
              return ok(photos.filter((p) => p.user_id === user));
            case 'photo_add':
              if (failAdd) return locked as RpcResult<T>;
              return ok(`${user}/${args.p_id}.jpg`);
            case 'photo_delete': {
              const p = photos.find((x) => x.id === args.p_id && x.user_id === user);
              if (!p)
                return {
                  data: null,
                  error: { message: 'Photo not found', code: 'P0002' },
                  status: 404,
                };
              return ok(p.storage_path);
            }
          }
          throw new Error(`unexpected rpc ${fn}`);
        },
      };
    },
    storage: {
      // deno-lint-ignore require-await
      async sign(paths, ttl) {
        calls.sign.push([paths, ttl]);
        return paths.map((path) => ({ path, signedUrl: `https://signed/${path}?ttl=${ttl}` }));
      },
      // deno-lint-ignore require-await
      async upload(path) {
        calls.upload.push(path);
      },
      // deno-lint-ignore require-await
      async remove(paths) {
        calls.remove.push(paths);
      },
    },
    newId: () => 'new-id',
    now: () => NOW,
  };
  return { deps, calls, failAdd: () => (failAdd = true) };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://fn/photos', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function uploadRequest(
  headers: Record<string, string>,
  file: Blob = new Blob([JPEG], { type: 'image/jpeg' }),
) {
  const form = new FormData();
  form.set('file', file, 'photo.jpg');
  form.set('taken_on', '2026-10-29');
  form.set('pose', 'side');
  form.set('width', '1200');
  form.set('height', '1600');
  return new Request('http://fn/photos', { method: 'POST', headers, body: form });
}

const alice = (token = 'alice-token') => ({
  authorization: 'Bearer alice-jwt',
  'x-photo-unlock': token,
});

Deno.test('CORS preflight', async () => {
  const { deps } = setup();
  const res = await handle(new Request('http://fn/photos', { method: 'OPTIONS' }), deps);
  assertEquals(res.status, 200);
  assert(res.headers.get('access-control-allow-headers')?.includes('x-photo-unlock'));
});

Deno.test('signed out: nothing is read or signed', async () => {
  const { deps, calls } = setup();
  const res = await handle(post({ action: 'list' }, { 'x-photo-unlock': 'alice-token' }), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.rpc.length + calls.sign.length, 0);
});

Deno.test('no unlock token: own photos cannot be listed or viewed', async () => {
  const { deps, calls } = setup();
  const res = await handle(post({ action: 'list' }, { authorization: 'Bearer alice-jwt' }), deps);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: 'locked' });
  assertEquals(calls.sign.length, 0);
});

Deno.test('wrong, expired or someone else’s token: no signed URLs', async () => {
  for (const headers of [alice('guess'), alice('alice-old'), alice('bob-token')]) {
    const { deps, calls } = setup();
    const res = await handle(post({ action: 'list' }, headers), deps);
    assertEquals(res.status, 403, headers['x-photo-unlock']);
    assertEquals(calls.sign.length, 0);
  }
});

Deno.test('unlocked: own photos only, URLs expire with the unlock', async () => {
  const { deps, calls } = setup();
  const res = await handle(post({ action: 'list' }, alice()), deps);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assertEquals(body.photos.length, 1);
  assertEquals(body.photos[0].id, 'p-alice');
  assertEquals(body.photos[0].url, `https://signed/${ALICE}/p-alice.jpg?ttl=240`);
  assertEquals(calls.sign, [[[`${ALICE}/p-alice.jpg`], 240]]);
  assert(240 <= MAX_URL_TTL);
});

Deno.test('upload without a valid token stores nothing', async () => {
  for (const headers of [
    { authorization: 'Bearer alice-jwt' },
    alice('guess'),
    alice('alice-old'),
  ]) {
    const { deps, calls } = setup();
    const res = await handle(uploadRequest(headers), deps);
    assertEquals(res.status, 403);
    assertEquals(calls.upload.length, 0);
  }
});

Deno.test('upload while unlocked goes into own folder', async () => {
  const { deps, calls } = setup();
  const res = await handle(uploadRequest(alice()), deps);
  assertEquals(res.status, 201);
  assertEquals(await res.json(), { id: 'new-id', storage_path: `${ALICE}/new-id.jpg` });
  assertEquals(calls.upload, [`${ALICE}/new-id.jpg`]);
  assertEquals(calls.remove.length, 0);
});

Deno.test('only real JPEGs up to 10 MB are accepted', async () => {
  const cases: [Blob, number][] = [
    [new Blob(['<script>'], { type: 'image/jpeg' }), 415],
    [new Blob([new Uint8Array(0)], { type: 'image/jpeg' }), 400],
    [new Blob([JPEG, new Uint8Array(10 * 1024 * 1024)], { type: 'image/jpeg' }), 413],
  ];
  for (const [file, status] of cases) {
    const { deps, calls } = setup();
    const res = await handle(uploadRequest(alice(), file), deps);
    assertEquals(res.status, status);
    assertEquals(calls.upload.length, 0);
  }
});

Deno.test('if recording the photo fails, the file is removed again', async () => {
  const { deps, calls, failAdd } = setup();
  failAdd();
  const res = await handle(uploadRequest(alice()), deps);
  assertEquals(res.status, 403);
  assertEquals(calls.remove, [[`${ALICE}/new-id.jpg`]]);
});

Deno.test('delete needs the token and only removes own photos', async () => {
  {
    const { deps, calls } = setup();
    const res = await handle(
      post({ action: 'delete', id: 'bbbb0000-0000-0000-0000-00000000000b' }, alice()),
      deps,
    );
    assertEquals(res.status, 404);
    assertEquals(calls.remove.length, 0);
  }
  {
    const { deps, calls } = setup();
    const res = await handle(
      post(
        { action: 'delete', id: 'bbbb0000-0000-0000-0000-00000000000b' },
        { authorization: 'Bearer bob-jwt', 'x-photo-unlock': 'alice-token' },
      ),
      deps,
    );
    assertEquals(res.status, 403);
    assertEquals(calls.remove.length, 0);
  }
  {
    const { deps, calls } = setup();
    const res = await handle(
      post(
        { action: 'delete', id: 'bbbb0000-0000-0000-0000-00000000000b' },
        { authorization: 'Bearer bob-jwt', 'x-photo-unlock': 'bob-token' },
      ),
      deps,
    );
    assertEquals(res.status, 200);
    assertEquals(calls.remove, [[`${BOB}/p-bob.jpg`]]);
  }
});

Deno.test('only POST', async () => {
  const { deps } = setup();
  const res = await handle(new Request('http://fn/photos'), deps);
  assertEquals(res.status, 405);
});
