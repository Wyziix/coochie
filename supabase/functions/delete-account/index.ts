// Deploy: npm run deploy:functions. Called from Settings → Delete account.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

import { rpc, service } from '../_shared/clients.ts';
import { handle } from './handler.ts';

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

/** Payload of a JWT that Supabase Auth has already verified. */
function claims(jwt: string): { amr?: { method: string; timestamp: number }[] } {
  const part = jwt.split('.')[1] ?? '';
  const padded = part
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(part.length / 4) * 4, '=');
  return JSON.parse(atob(padded));
}

Deno.serve((req) =>
  handle(req, {
    async session(authorization) {
      if (!/^Bearer \S+$/.test(authorization)) return null;
      const jwt = authorization.replace(/^Bearer\s+/i, '');
      const { data, error } = await createClient(url, publishableKey, {
        auth: noSession,
      }).auth.getUser(jwt);
      if (error || !data.user) return null;
      // When this session signed in (Google or email code), not a token refresh.
      const times = (claims(jwt).amr ?? []).map((a) => a.timestamp * 1000).filter(Number.isFinite);
      const signedInAt = times.length ? new Date(Math.max(...times)) : null;
      return { userId: data.user.id, signedInAt };
    },
    rpc,
    storage: {
      async list(bucket, folder) {
        const out: string[] = [];
        const walk = async (prefix: string) => {
          for (let offset = 0; ; offset += 1000) {
            const { data, error } = await service.storage
              .from(bucket)
              .list(prefix, { limit: 1000, offset });
            if (error) throw error;
            for (const item of data ?? []) {
              // Folders have no id.
              if (item.id) out.push(`${prefix}/${item.name}`);
              else await walk(`${prefix}/${item.name}`);
            }
            if (!data || data.length < 1000) break;
          }
        };
        await walk(folder);
        return out;
      },
      async remove(bucket, paths) {
        const { error } = await service.storage.from(bucket).remove(paths);
        if (error) throw error;
      },
    },
    async deleteAuthUser(userId) {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  }),
);
