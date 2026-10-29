// Real dependencies for the AI functions: Supabase (user check + service role)
// and Claude through the Anthropic SDK. The API key comes from the
// ANTHROPIC_API_KEY function secret; it is never in the app.
import Anthropic from 'npm:@anthropic-ai/sdk@0.134.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

import type { Claude } from './ai.ts';

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
  throw new Error('SUPABASE_URL and the API keys must be set');
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
export const service = createClient(url, secretKey, { auth: noSession });

const bearer = (authorization: string) => authorization.replace(/^Bearer\s+/i, '');

/** Verified by Supabase Auth (not just decoded). */
export async function userIdFromAuth(authorization: string): Promise<string | null> {
  if (!/^Bearer \S+$/.test(authorization)) return null;
  const { data, error } = await createClient(url!, publishableKey!, {
    auth: noSession,
  }).auth.getUser(bearer(authorization));
  return error ? null : (data.user?.id ?? null);
}

/** is_admin() as the user (reads their role from profiles). */
export async function isAdmin(authorization: string): Promise<boolean> {
  const client = createClient(url!, publishableKey!, {
    global: { headers: { Authorization: authorization } },
    auth: noSession,
  });
  const { data, error } = await client.rpc('is_admin');
  return !error && data === true;
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
// One retry for overloaded/5xx, and a hard 25 s timeout so the app gets an
// answer (or a clear error) well under a minute.
const anthropic = new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 });

export const claude: Claude = async ({ model, maxTokens, system, user, schema }) => {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    // The fixed system prompt is cached (5 minutes); only the data changes.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    // Short structured answers: no thinking, low effort, JSON that matches the schema.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return {
    text,
    stopReason: res.stop_reason,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
    },
  };
};
