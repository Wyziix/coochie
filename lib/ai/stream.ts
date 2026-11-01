import { env } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';

import { AiError } from './errors';
import { createSseParser } from './sse';

export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

/**
 * Sends a question to the coach Edge Function and streams the reply. Uses
 * XMLHttpRequest, whose progress events deliver text as it arrives on web
 * (incl. iPhone Safari) and on Android. Where a browser or proxy buffers the
 * response, the whole reply simply arrives at the end (the typing indicator
 * shows until then). Resolves with both saved messages.
 */
export async function streamCoachReply(
  message: string,
  onText: (textSoFar: string) => void,
  opts: { timeoutMs?: number } = {},
): Promise<CoachMessage[]> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AiError('auth', 'Sign in again.');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const parse = createSseParser();
    let seen = 0;
    let text = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const consume = () => {
      const body = xhr.responseText ?? '';
      if (body.length <= seen) return;
      const chunk = body.slice(seen);
      seen = body.length;
      if (xhr.status !== 200) return; // an error body is JSON, read on load
      for (const ev of parse(chunk)) {
        const d = ev.data as {
          text?: string;
          messages?: CoachMessage[];
          error?: string;
          message?: string;
        };
        if (ev.event === 'delta' && typeof d.text === 'string') {
          text += d.text;
          onText(text);
        } else if (ev.event === 'done' && Array.isArray(d.messages)) {
          finish(() => resolve(d.messages!));
        } else if (ev.event === 'error') {
          finish(() =>
            reject(new AiError(d.error ?? 'ai_error', d.message ?? 'The coach couldn’t answer.')),
          );
        }
      }
    };

    xhr.open('POST', `${env.supabaseUrl}/functions/v1/coach`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', env.supabasePublishableKey);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.timeout = opts.timeoutMs ?? 60_000;
    xhr.onprogress = consume;
    xhr.onload = () => {
      consume();
      if (settled) return;
      if (xhr.status !== 200) {
        let body: { error?: string; message?: string } | null = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        if (xhr.status === 404 && !body?.error) {
          return finish(() =>
            reject(
              Object.assign(new Error('The coach Edge Function isn’t deployed yet.'), {
                code: 'EDGE_FUNCTION_MISSING',
              }),
            ),
          );
        }
        return finish(() =>
          reject(
            new AiError(
              body?.error ?? `http_${xhr.status}`,
              body?.message ?? `The coach couldn’t answer (HTTP ${xhr.status}).`,
            ),
          ),
        );
      }
      finish(() =>
        reject(new AiError('ai_error', 'The connection dropped before the reply finished.')),
      );
    };
    xhr.onerror = () => finish(() => reject(new TypeError('Network request failed')));
    xhr.ontimeout = () =>
      finish(() => reject(new AiError('timeout', 'The coach took too long to answer.')));
    xhr.send(JSON.stringify({ message }));
  });
}
