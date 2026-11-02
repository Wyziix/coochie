#!/usr/bin/env node
// Makes the web push (VAPID) key pair. Run it once on your own computer:
//
//   node scripts/generate-vapid-keys.mjs you@example.com
//
// It writes .vapid.env (git-ignored) with the private key for Supabase and
// prints the public key for the app. The private key is never printed.
// Making new keys later signs everyone out of push (they turn it on again).
import { existsSync, writeFileSync } from 'node:fs';

const contact = process.argv[2];
if (!contact || !/^[^@\s]+@[^@\s]+$/.test(contact)) {
  console.error('Usage: node scripts/generate-vapid-keys.mjs <your email>');
  process.exit(1);
}
if (existsSync('.vapid.env') && !process.argv.includes('--force')) {
  console.error('.vapid.env already exists. Keep using it, or add --force to replace the keys.');
  process.exit(1);
}

const { subtle } = globalThis.crypto;
const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const publicJwk = await subtle.exportKey('jwk', keys.publicKey);
const privateJwk = await subtle.exportKey('jwk', keys.privateKey);
const raw = Buffer.from(await subtle.exportKey('raw', keys.publicKey)).toString('base64url');

writeFileSync(
  '.vapid.env',
  `VAPID_KEYS='${JSON.stringify({ publicKey: publicJwk, privateKey: privateJwk })}'\nVAPID_SUBJECT=mailto:${contact}\n`,
  { mode: 0o600 },
);

console.log('Wrote .vapid.env (private key, git-ignored). Next:');
console.log('');
console.log('1. Send it to Supabase:');
console.log(
  '   npx -y supabase@2.122.0 secrets set --env-file .vapid.env --project-ref gwyymvaxgmpamtiuhoez',
);
console.log('');
console.log('2. Add this line to .env (public, goes into the app):');
console.log(`   EXPO_PUBLIC_VAPID_PUBLIC_KEY=${raw}`);
