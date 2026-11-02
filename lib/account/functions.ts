import { env } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';

/** An Edge Function's error, with the message it sent (shown as is). */
export class FunctionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'FunctionError';
  }
}

export async function callFunction(
  name: 'export-data' | 'delete-account',
  init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new FunctionError('Sign in again.', 401, 'auth');
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: env.supabasePublishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      body: JSON.stringify(init.body ?? {}),
    });
  } catch {
    throw new FunctionError('No connection. Try again when you’re online.', 0, 'offline');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new FunctionError(
      body?.message ?? `Something went wrong (${res.status}). Try again in a minute.`,
      res.status,
      body?.error ?? null,
    );
  }
  return res;
}
