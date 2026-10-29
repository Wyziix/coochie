// deno test supabase/functions (npm run test:functions). Claude is faked: no
// API calls, no cost. The fake database follows the SQL (ai.test.sql proves it).
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

import { type ClaudeRequest, type ClaudeResponse, SCHEMAS, SYSTEM_PROMPT } from '../_shared/ai.ts';
import { type Deps, handle } from './handler.ts';

const USER = 'aaaa0000-0000-0000-0000-000000000001';
const W = (n: number) => `bbbb0000-0000-0000-0000-00000000000${n}`;

const good = {
  summary: 'Bench top set 90x5, up from 85x5 last week.',
  positives: ['New heaviest bench: 90 kg (was 85 kg).'],
  warnings: [],
  suggestions: ['Next time try 92.5x5 on bench.'],
  see_professional: false,
};

const answer = (content: unknown, stopReason = 'end_turn'): ClaudeResponse => ({
  text: typeof content === 'string' ? content : JSON.stringify(content),
  stopReason,
  usage: { input: 700, output: 120, cacheWrite: 0, cacheRead: 650 },
});

function setup(
  opts: { limit?: number; enabled?: boolean; answers?: (ClaudeResponse | Error)[] } = {},
) {
  const limit = opts.limit ?? 3;
  const state = {
    used: 0,
    pending: new Set<string>(),
    feedback: new Map<
      string,
      { id: string; content: unknown; created_at: string; source_updated_at: string }
    >(),
    finished: [] as Record<string, unknown>[],
    claudeCalls: [] as ClaudeRequest[],
    workoutUpdatedAt: '2026-10-29T10:00:00Z',
  };
  const answers = [...(opts.answers ?? [answer(good)])];
  const deps: Deps = {
    // deno-lint-ignore require-await
    async userIdFromAuth(a) {
      return a === 'Bearer user-jwt' ? USER : null;
    },
    // deno-lint-ignore require-await
    async existing(_u, workoutId) {
      return {
        feedback: state.feedback.get(workoutId) ?? null,
        workoutUpdatedAt: workoutId === W(9) ? null : state.workoutUpdatedAt,
      };
    },
    // deno-lint-ignore require-await
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      switch (fn) {
        case 'ai_reserve': {
          if (opts.enabled === false) return { ok: false, reason: 'disabled' } as T;
          if (state.pending.has(String(args.p_ref)))
            return { ok: false, reason: 'in_progress' } as T;
          if (state.used >= limit) return { ok: false, reason: 'limit', limit } as T;
          state.used++;
          state.pending.add(String(args.p_ref));
          return {
            ok: true,
            id: `r-${state.used}`,
            model: 'claude-haiku-5-5',
            max_tokens: 400,
          } as T;
        }
        case 'ai_finish':
          state.finished.push(args);
          if (args.p_status === 'error') state.used--; // errors don't count
          state.pending.clear();
          return 0 as T;
        case 'ai_workout_context':
          return {
            workout: { name: 'Push', exercises: [{ exercise: 'Bench', top_set: '90.0x5' }] },
          } as T;
        case 'ai_save_feedback': {
          const row = {
            id: `f-${args.p_workout}`,
            content: args.p_content,
            created_at: 'now',
            source_updated_at: state.workoutUpdatedAt,
          };
          state.feedback.set(String(args.p_workout), row);
          return row as T;
        }
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore require-await
    async claude(req) {
      state.claudeCalls.push(req);
      const next = answers.shift() ?? answer(good);
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { deps, state };
}

const post = (body: unknown, auth = 'Bearer user-jwt') =>
  new Request('http://fn/workout-feedback', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

Deno.test('feedback for a finished workout, saved and logged with tokens', async () => {
  const { deps, state } = setup();
  const res = await handle(post({ workout_id: W(1) }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.cached, false);
  assertEquals(body.feedback.content, good);
  assertEquals(state.claudeCalls.length, 1);
  const call = state.claudeCalls[0]!;
  assertEquals(call.model, 'claude-haiku-5-5');
  assertEquals(call.maxTokens, 400);
  assertEquals(call.system, SYSTEM_PROMPT);
  assertEquals(call.schema, SCHEMAS.workout_feedback);
  assertMatch(call.user, /^Task: workout_feedback\nData \(JSON\):\n\{/);
  assertEquals(state.finished[0], {
    p_id: 'r-1',
    p_status: 'ok',
    p_input: 700,
    p_output: 120,
    p_cache_write: 0,
    p_cache_read: 650,
    p_attempts: 1,
    p_error: null,
  });
});

Deno.test('reopening returns the saved feedback without calling Claude', async () => {
  const { deps, state } = setup();
  await handle(post({ workout_id: W(1) }), deps);
  const res = await handle(post({ workout_id: W(1) }), deps);
  assertEquals((await res.json()).cached, true);
  assertEquals(state.claudeCalls.length, 1);
  // Asking to regenerate an unchanged workout still costs nothing.
  await handle(post({ workout_id: W(1), regenerate: true }), deps);
  assertEquals(state.claudeCalls.length, 1);
  // After editing the workout, regenerating makes a new call.
  state.workoutUpdatedAt = '2026-10-29T12:00:00Z';
  const stale = await (await handle(post({ workout_id: W(1) }), deps)).json();
  assertEquals(stale.stale, true);
  await handle(post({ workout_id: W(1), regenerate: true }), deps);
  assertEquals(state.claudeCalls.length, 2);
});

Deno.test(
  'the 4th request of the day is blocked with a clear message, before calling Claude',
  async () => {
    const { deps, state } = setup();
    for (const n of [1, 2, 3])
      assertEquals((await handle(post({ workout_id: W(n) }), deps)).status, 200);
    const res = await handle(post({ workout_id: W(4) }), deps);
    assertEquals(res.status, 429);
    assertEquals(await res.json(), {
      error: 'limit',
      message: 'You’ve used your 3 AI requests for today. You get new ones tomorrow.'.replace(
        '’',
        "'",
      ),
    });
    assertEquals(state.claudeCalls.length, 3);
  },
);

Deno.test('kill switch: no call, clear message', async () => {
  const { deps, state } = setup({ enabled: false });
  const res = await handle(post({ workout_id: W(1) }), deps);
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error, 'disabled');
  assertEquals(state.claudeCalls.length, 0);
});

Deno.test('invalid output: retried once, then accepted', async () => {
  const tooLong = { ...good, suggestions: ['a', 'b', 'c'] };
  const { deps, state } = setup({ answers: [answer(tooLong), answer(good)] });
  const res = await handle(post({ workout_id: W(1) }), deps);
  assertEquals(res.status, 200);
  assertEquals(state.claudeCalls.length, 2);
  assertMatch(state.claudeCalls[1]!.user, /couldn't be used \(suggestions needs 1 to 2 items\)/);
  assertEquals(state.finished[0]!.p_attempts, 2);
  assertEquals(state.finished[0]!.p_input, 1400); // both attempts' tokens logged
});

Deno.test('invalid twice: clean error, logged as an error, the call is not used up', async () => {
  const { deps, state } = setup({ answers: [answer('not json'), answer({ summary: 'x' })] });
  const res = await handle(post({ workout_id: W(1) }), deps);
  assertEquals(res.status, 502);
  assertEquals(await res.json(), {
    error: 'invalid_output',
    message: 'Couldn’t get usable feedback this time. Try again later.',
  });
  assertEquals(state.claudeCalls.length, 2);
  assertEquals(state.finished[0]!.p_status, 'error');
  assertEquals(state.used, 0);
  assertEquals(state.feedback.size, 0);
});

Deno.test('cut off or refused answers count as invalid', async () => {
  const { deps, state } = setup({
    answers: [answer('{"summary": "Bench', 'max_tokens'), answer('', 'refusal')],
  });
  const res = await handle(post({ workout_id: W(1) }), deps);
  assertEquals(res.status, 502);
  assertEquals(state.claudeCalls.length, 2);
});

Deno.test('timeout and API errors give a clear message and are logged', async () => {
  for (const [error, status, code] of [
    [
      Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }),
      504,
      'timeout',
    ],
    [new Error('529 Overloaded'), 502, 'ai_error'],
  ] as const) {
    const { deps, state } = setup({ answers: [error] });
    const res = await handle(post({ workout_id: W(1) }), deps);
    assertEquals(res.status, status);
    assertEquals((await res.json()).error, code);
    assertEquals(state.finished[0]!.p_status, 'error');
  }
});

Deno.test('a double tap is refused while the first call runs', async () => {
  const { deps, state } = setup();
  let release!: () => void;
  const slow = new Promise<void>((r) => (release = r));
  const original = deps.claude;
  deps.claude = async (req) => {
    await slow;
    return original(req);
  };
  const first = handle(post({ workout_id: W(1) }), deps);
  const second = await handle(post({ workout_id: W(1) }), deps);
  assertEquals(second.status, 409);
  release();
  assertEquals((await first).status, 200);
  assertEquals(state.claudeCalls.length, 1);
});

Deno.test('not signed in, missing or unsynced workout', async () => {
  const { deps, state } = setup();
  assertEquals((await handle(post({ workout_id: W(1) }, 'Bearer nope'), deps)).status, 401);
  assertEquals((await handle(post({ workout_id: 'x' }), deps)).status, 400);
  const res = await handle(post({ workout_id: W(9) }), deps);
  assertEquals(res.status, 404);
  assertMatch((await res.json()).message, /wait until it has synced/);
  assertEquals(state.claudeCalls.length, 0);
});

Deno.test('the system prompt is long enough to be cached and has no changing parts', () => {
  // Claude Haiku 5.5 caches prefixes of 512+ tokens (~4 characters per token).
  assert(SYSTEM_PROMPT.length > 2600, `system prompt is ${SYSTEM_PROMPT.length} characters`);
  assert(!/\d{4}-\d{2}-\d{2}/.test(SYSTEM_PROMPT), 'no dates in the cached prompt');
});
