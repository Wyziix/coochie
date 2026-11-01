// POST { message, stream? } with the user's JWT → the coach's reply.
// - stream (default): Server-Sent Events. "delta" events carry the text as it
//   arrives, then "done" with both saved messages, or "error".
// - stream: false: one JSON response with both saved messages (fallback).
// Limits, kill switch and spending cap are checked by ai_reserve() first;
// those refusals are plain JSON errors. The question and the reply are saved
// together once the reply is complete, even if the app has gone away.
// Testable with fakes (handler.test.ts).
import {
  type ClaudeStream,
  corsHeaders,
  finishCall,
  isTimeout,
  json,
  refusal,
  type ChatMessage,
  type Reservation,
  type Usage,
} from '../_shared/ai.ts';
import { COACH_PROMPT, conversation, dataBlock, HISTORY, MAX_MESSAGE } from './prompt.ts';

export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

export type Deps = {
  userIdFromAuth(authorization: string): Promise<string | null>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** The user's last `limit` messages, oldest first. */
  history(userId: string, limit: number): Promise<ChatMessage[]>;
  /** Saves the question and the reply (in this order); returns the saved rows. */
  save(
    userId: string,
    rows: { role: 'user' | 'assistant'; content: string; created_at: string }[],
  ): Promise<CoachMessage[]>;
  claudeStream: ClaudeStream;
  /** Keeps the function running after the response (the app may disconnect). */
  waitUntil?(work: Promise<unknown>): void;
  now?(): Date;
};

type Outcome =
  | { ok: true; messages: CoachMessage[] }
  | { ok: false; error: string; message: string; status: number };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method', message: 'Method not allowed' }, 405);

  const userId = await deps
    .userIdFromAuth(req.headers.get('authorization') ?? '')
    .catch(() => null);
  if (!userId) return json({ error: 'auth', message: 'Sign in again.' }, 401);

  const body = (await req.json().catch(() => null)) as {
    message?: unknown;
    stream?: unknown;
  } | null;
  const question = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!question) return json({ error: 'bad_request', message: 'Type a question first.' }, 400);
  if (question.length > MAX_MESSAGE) {
    return json({ error: 'bad_request', message: `Keep it under ${MAX_MESSAGE} characters.` }, 400);
  }
  const streaming = body?.stream !== false;

  const r = await deps.rpc<Reservation>('ai_reserve', {
    p_user: userId,
    p_function: 'coach',
    p_ref: 'chat',
    p_counts: true,
  });
  if (!r.ok) {
    const { status, ...rest } = refusal(r.reason, r.limit, 'coach');
    return json(rest, status);
  }
  const askedAt = (deps.now?.() ?? new Date()).toISOString();

  if (!streaming) {
    const outcome = await reply(deps, userId, r, question, askedAt, () => {});
    if (!outcome.ok)
      return json({ error: outcome.error, message: outcome.message }, outcome.status);
    return json({ messages: outcome.messages });
  }

  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const write = (chunk: string) => {
    if (!open) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      open = false; // the app went away; keep going so the reply is saved
    }
  };
  const send = (event: string, data: unknown) =>
    write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false;
    },
  });

  const work = (async () => {
    // A comment first (padded), so proxies and browsers start passing data on.
    write(`: ${' '.repeat(2048)}\n\n`);
    const outcome = await reply(deps, userId, r, question, askedAt, (text) =>
      send('delta', { text }),
    );
    if (outcome.ok) send('done', { messages: outcome.messages });
    else send('error', { error: outcome.error, message: outcome.message });
    if (open) {
      open = false;
      try {
        controller.close();
      } catch {
        // already closed
      }
    }
  })();
  deps.waitUntil?.(work);

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function reply(
  deps: Deps,
  userId: string,
  r: Extract<Reservation, { ok: true }>,
  question: string,
  askedAt: string,
  onText: (text: string) => void,
): Promise<Outcome> {
  let usage: Usage | undefined;
  try {
    const [context, history] = await Promise.all([
      deps.rpc<unknown>('ai_coach_context', { p_user: userId }),
      deps.history(userId, HISTORY),
    ]);
    const res = await deps.claudeStream({
      model: r.model,
      maxTokens: r.max_tokens,
      system: COACH_PROMPT,
      data: dataBlock(context),
      messages: conversation(history, question),
      onText,
    });
    usage = res.usage;
    let text = res.text.trim();
    if (res.stopReason === 'refusal' || !text) {
      await finishCall(deps.rpc, r.id, 'error', usage, 1, `no answer (${res.stopReason})`);
      return {
        ok: false,
        status: 502,
        error: 'no_answer',
        message: 'The coach couldn’t answer that. Try asking another way.',
      };
    }
    if (res.stopReason === 'max_tokens') text = `${text}…`;
    const answeredAt = Math.max((deps.now?.() ?? new Date()).getTime(), Date.parse(askedAt) + 1);
    const messages = await deps.save(userId, [
      { role: 'user', content: question, created_at: askedAt },
      { role: 'assistant', content: text, created_at: new Date(answeredAt).toISOString() },
    ]);
    await finishCall(deps.rpc, r.id, 'ok', usage, 1);
    return { ok: true, messages };
  } catch (error) {
    await finishCall(
      deps.rpc,
      r.id,
      'error',
      usage,
      1,
      String((error as Error)?.message ?? error),
    ).catch(() => {});
    return isTimeout(error)
      ? {
          ok: false,
          status: 504,
          error: 'timeout',
          message: 'The coach took too long to answer. Try again in a minute.',
        }
      : {
          ok: false,
          status: 502,
          error: 'ai_error',
          message: 'The coach couldn’t answer right now. Try again in a minute.',
        };
  }
}
