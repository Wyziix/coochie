// Deploy: npm run deploy:functions (JWT check is done here via PostgREST, see handler.ts).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

import { handle } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');

/** New API keys come as JSON ({"default": "sb_..."}); older projects have the legacy JWT keys. */
function key(jsonName: string, legacyName: string): string | undefined {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // fall back to the legacy key
    }
  }
  return Deno.env.get(legacyName);
}

const publishableKey = key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const secretKey = key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
if (!url || !publishableKey || !secretKey) {
  throw new Error('photos function: SUPABASE_URL and the API keys must be set');
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const bucket = createClient(url, secretKey, { auth: noSession }).storage.from('progress-photos');

Deno.serve((req) =>
  handle(req, {
    userDb(authorization) {
      const client = createClient(url, publishableKey, {
        global: { headers: { Authorization: authorization } },
        auth: noSession,
      });
      return {
        async rpc(fn, args) {
          const { data, error, status } = await client.rpc(fn, args);
          return { data, error, status };
        },
      };
    },
    storage: {
      async sign(paths, ttlSeconds) {
        const { data, error } = await bucket.createSignedUrls(paths, ttlSeconds);
        if (error) throw error;
        return data.map((d) => ({ path: d.path ?? '', signedUrl: d.signedUrl }));
      },
      async upload(path, file) {
        const { error } = await bucket.upload(path, file, {
          contentType: 'image/jpeg',
          upsert: false,
          cacheControl: '0',
        });
        if (error) throw error;
      },
      async remove(paths) {
        const { error } = await bucket.remove(paths);
        if (error) throw error;
      },
    },
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
  }),
);
