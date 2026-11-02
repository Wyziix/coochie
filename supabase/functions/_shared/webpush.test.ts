// Real encryption and VAPID signing against a fake push service (fetch is
// replaced, so nothing leaves the machine).
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import * as webpush from 'jsr:@negrel/webpush@0.3.0';

import { importKeys, webPushSender } from './webpush.ts';

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function browserSubscription(endpoint: string) {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = await crypto.subtle.exportKey('raw', ua.publicKey);
  return {
    endpoint,
    p256dh: b64url(raw),
    auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

async function withFakePushService(status: number, run: (seen: Request[]) => Promise<void>) {
  const seen: Request[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return Promise.resolve(new Response(null, { status }));
  };
  try {
    await run(seen);
  } finally {
    globalThis.fetch = real;
  }
}

const keysJson = async () =>
  JSON.stringify(
    await webpush.exportVapidKeys(await webpush.generateVapidKeys({ extractable: true })),
  );

Deno.test('encrypts, signs with VAPID and posts to the endpoint', async () => {
  const json = await keysJson();
  const deliver = webPushSender(() => importKeys(json), 'mailto:admin@example.com');
  const sub = await browserSubscription('https://fcm.googleapis.com/fcm/send/abc');
  await withFakePushService(201, async (seen) => {
    assertEquals(
      await deliver(sub, '{"title":"Rest is over"}', { ttl: 120, urgency: 'high' }),
      'ok',
    );
    const req = seen[0]!;
    assertEquals(req.url, sub.endpoint);
    assertEquals(req.headers.get('content-encoding'), 'aes128gcm');
    assertEquals(req.headers.get('ttl'), '120');
    assertEquals(req.headers.get('urgency'), 'high');
    assertMatch(req.headers.get('authorization')!, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const body = new Uint8Array(await req.arrayBuffer());
    assert(body.length > 40, 'encrypted body');
    assert(!new TextDecoder().decode(body).includes('Rest is over'), 'not readable on the way');
  });
});

Deno.test('410 and 404 mean the subscription is gone; 5xx is an error', async () => {
  const json = await keysJson();
  const deliver = webPushSender(() => importKeys(json), 'mailto:admin@example.com');
  const sub = await browserSubscription('https://web.push.apple.com/xyz');
  for (const [status, result] of [
    [410, 'gone'],
    [404, 'gone'],
    [500, 'error'],
  ] as const) {
    await withFakePushService(status, async () => {
      assertEquals(await deliver(sub, '{}', { ttl: 60, urgency: 'normal' }), result);
    });
  }
});
