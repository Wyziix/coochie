// deno test supabase/functions. Claude is faked (streamed in pieces): no API
// calls, no cost.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

import type { ChatMessage, ClaudeResponse, StreamRequest } from '../_shared/ai.ts';
import { type CoachMessage, type Deps, handle } from './handler.ts';
import { COACH_PROMPT, conversation } from './prompt.ts';

const USER = 'aaaa0000-0000-0000-0000-000000000001';

type Script = { pieces: string[]; stopReason?: string } | Error;

function setup(
  opts: { limit?: number; enabled?: boolean; scripts?: Script[]; history?: ChatMessage[] } = {},
) {
  const limit = opts.limit ?? 15;
  const state = {
    used: 0,
    finished: [] as Record<string, unknown>[],
    calls: [] as Omit<StreamRequest, 'onText'>[],
    saved: [] as CoachMessage[],
    background: [] as Promise<unknown>[],
  };
  const scripts = [...(opts.scripts ?? [{ pieces: ['Your bench ', 'went up 5 kg.'] }])];
  const deps: Deps = {
    // deno-lint-ignore require-await
    async userIdFromAuth(a) {
      return a === 'Bearer user-jwt' ? USER : null;
    },
    // deno-lint-ignore require-await
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      switch (fn) {
        case 'ai_reserve':
          if (opts.enabled === false) return { ok: false, reason: 'disabled' } as T;
          if (state.used >= limit) return { ok: false, reason: 'limit', limit } as T;
          state.used++;
          return {
            ok: true,
            id: `r-${state.used}`,
            model: 'claude-haiku-5-5',
            max_tokens: 400,
          } as T;
        case 'ai_finish':
          state.finished.push(args);
          if (args.p_status === 'error') state.used--;
          return 0 as T;
        case 'ai_coach_context':
          return {
            athlete: { goal: 'strength' },
            recent_workouts: [{ name: 'Push', sets: 'Bench 3x, top 90x5' }],
          } as T;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore require-await
    async history(_u, n) {
      return (opts.history ?? []).slice(-n);
    },
    // deno-lint-ignore require-await
    async save(_u, rows) {
      const saved = rows.map((row, i) => ({ id: `m${state.saved.length + i + 1}`, ...row }));
      state.saved.push(...saved);
      return saved;
    },
    async claudeStream(req) {
      const { onText, ...rest } = req;
      state.calls.push(rest);
      const script = scripts.shift() ?? { pieces: ['ok'] };
      if (script instanceof Error) throw script;
      for (const piece of script.pieces) {
        await new Promise((r) => setTimeout(r, 1));
        onText(piece);
      }
      return {
        text: script.pieces.join(''),
        stopReason: script.stopReason ?? 'end_turn',
        usage: { input: 1200, output: 80, cacheWrite: 0, cacheRead: 900 },
      } satisfies ClaudeResponse;
    },
    waitUntil(work) {
      state.background.push(work);
    },
    now: () => new Date('2026-11-01T10:00:00Z'),
  };
  return { deps, state };
}

const post = (body: unknown, auth = 'Bearer user-jwt') =>
  new Request('http://fn/coach', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Parses an SSE body into [event, data] pairs. */
async function events(res: Response) {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event: '))
    .map((block) => {
      const [e, d] = block.split('\n');
      return [e!.slice(7), JSON.parse(d!.slice(6))] as const;
    });
}

Deno.test('a streamed reply: text in pieces, then both messages saved', async () => {
  const { deps, state } = setup();
  const res = await handle(post({ message: '  How is my bench going? ' }), deps);
  assertEquals(res.status, 200);
  assertMatch(res.headers.get('content-type')!, /^text\/event-stream/);
  const ev = await events(res);
  assertEquals(ev.slice(0, 2), [
    ['delta', { text: 'Your bench ' }],
    ['delta', { text: 'went up 5 kg.' }],
  ]);
  assertEquals(ev[2]![0], 'done');
  assertEquals(
    ev[2]![1].messages.map((m: CoachMessage) => [m.role, m.content]),
    [
      ['user', 'How is my bench going?'],
      ['assistant', 'Your bench went up 5 kg.'],
    ],
  );
  assert(
    state.saved[1]!.created_at > state.saved[0]!.created_at,
    'the reply sorts after the question',
  );
  const call = state.calls[0]!;
  assertEquals(call.system, COACH_PROMPT);
  assertEquals(call.maxTokens, 400);
  assertMatch(
    call.data,
    /^The lifter's training data right now .*\n\{"athlete":\{"goal":"strength"\}/,
  );
  assertEquals(call.messages, [{ role: 'user', content: 'How is my bench going?' }]);
  assertEquals(state.finished[0]!.p_status, 'ok');
  assertEquals(state.finished[0]!.p_cache_read, 900);
});

Deno.test('only the last 10 messages go with the question, as a valid conversation', async () => {
  const history: ChatMessage[] = Array.from({ length: 14 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `m${i}`,
  }));
  const { deps, state } = setup({ history });
  await (await handle(post({ message: 'next' }), deps)).text();
  const sent = state.calls[0]!.messages;
  // m4..m13 are the last 10; the oldest kept starts with the user.
  assertEquals(sent[0], { role: 'user', content: 'm4' });
  assertEquals(sent.length, 11);
  assertEquals(sent.at(-1), { role: 'user', content: 'next' });
});

Deno.test('conversation(): starts with the user, alternates, joins repeats', () => {
  assertEquals(
    conversation(
      [
        { role: 'assistant', content: 'old reply' },
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
      'c',
    ),
    [{ role: 'user', content: 'a\n\nb\n\nc' }],
  );
});

Deno.test('fallback without streaming: one JSON response', async () => {
  const { deps } = setup();
  const res = await handle(post({ message: 'Hi', stream: false }), deps);
  assertEquals(res.status, 200);
  assertMatch(res.headers.get('content-type')!, /json/);
  const body = await res.json();
  assertEquals(body.messages[1].content, 'Your bench went up 5 kg.');
});

Deno.test('the 16th message of the day is blocked before calling Claude', async () => {
  const { deps, state } = setup({ limit: 15 });
  for (let i = 0; i < 15; i++) await (await handle(post({ message: `q${i}` }), deps)).text();
  const res = await handle(post({ message: 'one more' }), deps);
  assertEquals(res.status, 429);
  assertEquals(await res.json(), {
    error: 'limit',
    message: "You've used your 15 coach messages for today. You get new ones tomorrow.",
  });
  assertEquals(state.calls.length, 15);
});

Deno.test('kill switch, empty or long message, not signed in', async () => {
  const off = setup({ enabled: false });
  assertEquals((await handle(post({ message: 'hi' }), off.deps)).status, 503);
  const { deps, state } = setup();
  assertEquals((await handle(post({ message: 'hi' }, 'Bearer x'), deps)).status, 401);
  assertEquals((await handle(post({ message: '   ' }), deps)).status, 400);
  assertEquals((await handle(post({ message: 'x'.repeat(1001) }), deps)).status, 400);
  assertEquals(state.calls.length + off.state.calls.length, 0);
});

Deno.test('an API error mid-stream: error event, nothing saved, not counted', async () => {
  const { deps, state } = setup({ scripts: [new Error('529 Overloaded')] });
  const ev = await events(await handle(post({ message: 'hi' }), deps));
  assertEquals(ev, [
    [
      'error',
      { error: 'ai_error', message: 'The coach couldn’t answer right now. Try again in a minute.' },
    ],
  ]);
  assertEquals(state.saved.length, 0);
  assertEquals(state.finished[0]!.p_status, 'error');
  assertEquals(state.used, 0);
});

Deno.test('a cut-off reply is saved with an ellipsis; a refusal is an error', async () => {
  const cut = setup({ scripts: [{ pieces: ['Long answer'], stopReason: 'max_tokens' }] });
  await (await handle(post({ message: 'hi' }), cut.deps)).text();
  assertEquals(cut.state.saved[1]!.content, 'Long answer…');

  const refused = setup({ scripts: [{ pieces: [], stopReason: 'refusal' }] });
  const ev = await events(await handle(post({ message: 'hi' }), refused.deps));
  assertEquals(ev[0]![0], 'error');
  assertEquals(refused.state.saved.length, 0);
});

Deno.test('the reply is saved even if the app disconnects mid-stream', async () => {
  const { deps, state } = setup({ scripts: [{ pieces: ['a', 'b', 'c', 'd'] }] });
  const res = await handle(post({ message: 'hi' }), deps);
  const reader = res.body!.getReader();
  await reader.read(); // the padding comment
  await reader.cancel(); // the app goes away
  await Promise.all(state.background);
  assertEquals(
    state.saved.map((m) => m.content),
    ['hi', 'abcd'],
  );
  assertEquals(state.finished[0]!.p_status, 'ok');
});

Deno.test('the coach prompt is long enough to be cached, fixed, and has the safety rules', () => {
  assert(COACH_PROMPT.length > 2600, `coach prompt is ${COACH_PROMPT.length} characters`);
  assert(!/\d{4}-\d{2}-\d{2}/.test(COACH_PROMPT));
  assertMatch(COACH_PROMPT, /never diagnose/);
  assertMatch(COACH_PROMPT, /see a doctor or physiotherapist/);
  assertMatch(COACH_PROMPT, /can only help with training, recovery and nutrition/);
});

Deno.test('nutrition: the 7-day summary is added only when food was logged', async () => {
  const { deps, state } = setup();
  const rpc = deps.rpc;
  const asked: Record<string, unknown>[] = [];
  deps.rpc = <T>(fn: string, args: Record<string, unknown>) => {
    if (fn !== 'ai_nutrition_summary') return rpc<T>(fn, args);
    asked.push(args);
    return Promise.resolve({
      days_logged: 5,
      avg_kcal: 2210,
      avg_protein_g: 128,
      target_kcal: 2400,
      target_protein_g: 160,
    } as T);
  };
  await (await handle(post({ message: 'Am I eating enough protein?' }), deps)).text();
  assertEquals(asked[0], { p_user: USER, p_from: '2026-10-26', p_to: '2026-11-01' });
  assertMatch(
    state.calls[0]!.data,
    /"nutrition":\{"days_logged":5,"avg_kcal":2210,"avg_protein_g":128,"target_kcal":2400,"target_protein_g":160\}/,
  );

  const plain = setup();
  await (await handle(post({ message: 'hi' }), plain.deps)).text();
  assert(
    !plain.state.calls[0]!.data.includes('nutrition'),
    'no food logged: no nutrition in the context',
  );
});
