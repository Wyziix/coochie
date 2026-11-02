// Deploy: npm run deploy:functions. The app calls it from Settings → Export.
import { zipSync } from 'npm:fflate@0.8.2';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

import { rpc, service, userIdFromAuth } from '../_shared/clients.ts';
import { handle, type Photo } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
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
const publishableKey = key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')!;
const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

Deno.serve((req) =>
  handle(req, {
    userIdFromAuth,
    rpc,
    async unlockedPhotos(authorization, token) {
      // As the user, so the photo lock checks their own token.
      const client = createClient(url, publishableKey, {
        global: { headers: { Authorization: authorization } },
        auth: noSession,
      });
      const { data, error } = await client.rpc('photo_list', { p_token: token });
      return error ? null : ((data ?? []) as Photo[]);
    },
    async downloadPhoto(path) {
      const { data, error } = await service.storage.from('progress-photos').download(path);
      if (error || !data) throw error ?? new Error('not found');
      return new Uint8Array(await data.arrayBuffer());
    },
    zip(files) {
      return zipSync(
        Object.fromEntries(
          Object.entries(files).map(([name, f]) => [name, [f.data, { level: f.compress ? 6 : 0 }]]),
        ),
      );
    },
  }),
);
