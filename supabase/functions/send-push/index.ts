// Deploy: npm run deploy:functions. Called by pg_cron through push_due().
// Secrets: VAPID_KEYS and VAPID_SUBJECT (docs/SETUP.md, "Web push").
import { rpc } from '../_shared/clients.ts';
import { importKeys, webPushSender } from '../_shared/webpush.ts';
import { handle } from './handler.ts';

let keys: Promise<CryptoKeyPair> | null = null;
const deliver = webPushSender(
  () => {
    const raw = Deno.env.get('VAPID_KEYS');
    if (!raw) return Promise.reject(new Error('VAPID_KEYS is not set'));
    keys ??= importKeys(raw);
    return keys;
  },
  Deno.env.get('VAPID_SUBJECT') ?? 'https://lightweightbaby.pages.dev',
);

Deno.serve((req) => handle(req, { rpc, deliver }));
