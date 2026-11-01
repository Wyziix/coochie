// deno test supabase/functions. Claude is faked: no API calls, no cost.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

import type { ClaudeRequest, ClaudeResponse } from '../_shared/ai.ts';
import { type Deps, handle } from './handler.ts';
import { PLAN_PROMPT, PLAN_SCHEMA } from './plan.ts';

const USER = 'aaaa0000-0000-0000-0000-000000000001';
const IDS: Record<string, string> = {
  e1: '11111111-0000-0000-0000-000000000001',
  e2: '11111111-0000-0000-0000-000000000002',
  e3: '11111111-0000-0000-0000-000000000003',
  e4: '11111111-0000-0000-0000-000000000004',
};
const NAMES: Record<string, string> = {
  e1: 'Bench Press (Barbell)',
  e2: 'Squat (Barbell)',
  e3: 'Pull-up',
  e4: 'Plank Row',
};

const ex = (id: string, sets = 3) => ({ id, sets, reps_min: 6, reps_max: 10, rest_seconds: 120 });
const day = (name: string, ids = ['e1', 'e2', 'e3']) => ({
  name,
  focus: 'Full body',
  exercises: ids.map((id) => ex(id)),
});
const plan = (days = 3, extra: Record<string, unknown> = {}) => ({
  name: '3-day full body',
  description: 'For a beginner who trains three times a week.',
  weeks: 6,
  progression: 'Add 2.5 kg when you hit the top of the rep range on every set.',
  days: Array.from({ length: days }, (_, i) => day(`Full body ${i + 1}`)),
  notes: ['Warm up with two lighter sets.'],
  ...extra,
});

const answer = (content: unknown, stopReason = 'end_turn'): ClaudeResponse => ({
  text: typeof content === 'string' ? content : JSON.stringify(content),
  stopReason,
  usage: { input: 1800, output: 900, cacheWrite: 0, cacheRead: 700 },
});

const request = {
  goal: 'hypertrophy',
  experience: 'beginner',
  days_per_week: 3,
  session_minutes: 60,
  equipment: 'full_gym',
};

function setup(
  opts: { limit?: number; enabled?: boolean; answers?: (ClaudeResponse | Error)[] } = {},
) {
  const limit = opts.limit ?? 2;
  const state = {
    used: 0,
    finished: [] as Record<string, unknown>[],
    claudeCalls: [] as ClaudeRequest[],
    contextArgs: [] as Record<string, unknown>[],
  };
  const answers = [...(opts.answers ?? [answer(plan())])];
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
            max_tokens: 1500,
          } as T;
        case 'ai_finish':
          state.finished.push(args);
          if (args.p_status === 'error') state.used--;
          return 0 as T;
        case 'ai_plan_context':
          state.contextArgs.push(args);
          return {
            prompt: {
              athlete: { goal: 'hypertrophy', experience: 'beginner' },
              history: { sessions: 4 },
              exercises:
                args.p_equipment === 'bodyweight'
                  ? []
                  : Object.entries(NAMES).map(([k, n]) => `${k} ${n} [chest]`),
            },
            ids: IDS,
            names: NAMES,
          } as T;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore require-await
    async claude(req) {
      state.claudeCalls.push(req);
      const next = answers.shift() ?? answer(plan());
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { deps, state };
}

const post = (body: unknown, auth = 'Bearer user-jwt') =>
  new Request('http://fn/generate-plan', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

Deno.test(
  'a plan from the form, with real exercise ids and names, logged with tokens',
  async () => {
    const { deps, state } = setup();
    const res = await handle(post(request), deps);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.plan.days.length, 3);
    assertEquals(body.plan.days[0].exercises[0], {
      exercise_id: IDS.e1,
      name: 'Bench Press (Barbell)',
      sets: 3,
      reps_min: 6,
      reps_max: 10,
      rest_seconds: 120,
    });
    assertEquals(body.plan.weeks, 6);
    const call = state.claudeCalls[0]!;
    assertEquals(call.maxTokens, 1500);
    assertEquals(call.model, 'claude-haiku-5-5');
    assertEquals(call.system, PLAN_PROMPT);
    assertEquals(call.schema, PLAN_SCHEMA);
    assertMatch(call.user, /^Request: \{"goal":"hypertrophy".*"equipment":"full_gym"\}\n/);
    assertMatch(call.user, /\nExercises:\ne1 Bench Press \(Barbell\) \[chest\]\n/);
    assert(!call.user.includes(IDS.e1), 'real ids are not sent to Claude');
    assertEquals(state.contextArgs[0], { p_user: USER, p_equipment: 'full_gym' });
    assertEquals(state.finished[0]!.p_status, 'ok');
    assertEquals(state.finished[0]!.p_output, 900);
  },
);

Deno.test('an unknown exercise is rejected and Claude is asked once more', async () => {
  const bad = plan(3, { days: [day('A', ['e1', 'e99', 'e2']), day('B'), day('C')] });
  const { deps, state } = setup({ answers: [answer(bad), answer(plan())] });
  const res = await handle(post(request), deps);
  assertEquals(res.status, 200);
  assertEquals(state.claudeCalls.length, 2);
  assertMatch(
    state.claudeCalls[1]!.user,
    /couldn't be used \(unknown exercise id "e99" in day 1; use only ids from the exercise list\)/,
  );
  assertEquals(state.finished[0]!.p_attempts, 2);
  assertEquals(state.finished[0]!.p_input, 3600);
});

Deno.test('wrong twice: clean error, nothing counted', async () => {
  const bad = plan(3, { days: [day('A', ['e1', 'e99', 'e2']), day('B'), day('C')] });
  const { deps, state } = setup({ answers: [answer(bad), answer(bad)] });
  const res = await handle(post(request), deps);
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, 'invalid_output');
  assertEquals(state.finished[0]!.p_status, 'error');
  assertEquals(state.used, 0);
});

Deno.test('the plan is checked: day count, exercises per day, sets, reps, rest', async () => {
  for (const [bad, reason] of [
    [plan(2), /exactly 3 days/],
    [
      plan(3, { days: [day('A', ['e1', 'e2']), day('B'), day('C')] }),
      /day 1 needs 3 to 8 exercises/,
    ],
    [
      plan(3, { days: [day('A', ['e1', 'e1', 'e2']), day('B'), day('C')] }),
      /e1 is used twice in day 1/,
    ],
    [
      plan(3, {
        days: [{ ...day('A'), exercises: [ex('e1', 9), ex('e2'), ex('e3')] }, day('B'), day('C')],
      }),
      /sets must be 1 to 6/,
    ],
    [
      plan(3, {
        days: [
          {
            ...day('A'),
            exercises: [{ ...ex('e1'), reps_min: 12, reps_max: 8 }, ex('e2'), ex('e3')],
          },
          day('B'),
          day('C'),
        ],
      }),
      /reps_min <= reps_max/,
    ],
    [
      plan(3, {
        days: [
          { ...day('A'), exercises: [{ ...ex('e1'), rest_seconds: 900 }, ex('e2'), ex('e3')] },
          day('B'),
          day('C'),
        ],
      }),
      /rest_seconds/,
    ],
    [plan(3, { weeks: 40 }), /weeks/],
    [plan(3, { notes: ['a', 'b', 'c', 'd'] }), /notes/],
  ] as const) {
    const { deps, state } = setup({ answers: [answer(bad), answer(plan())] });
    assertEquals((await handle(post(request), deps)).status, 200);
    assertMatch(state.claudeCalls[1]!.user, reason);
  }
});

Deno.test('cut off answers are retried, and count as invalid', async () => {
  const { deps, state } = setup({
    answers: [answer('{"name": "3-day', 'max_tokens'), answer('', 'refusal')],
  });
  assertEquals((await handle(post(request), deps)).status, 502);
  assertMatch(state.claudeCalls[1]!.user, /answer was cut off/);
});

Deno.test('the 3rd plan of the day is blocked (regenerating counts too)', async () => {
  const { deps, state } = setup();
  assertEquals((await handle(post(request), deps)).status, 200);
  assertEquals((await handle(post(request), deps)).status, 200);
  const res = await handle(post(request), deps);
  assertEquals(res.status, 429);
  assertEquals(await res.json(), {
    error: 'limit',
    message: "You've used your 2 plan generations for today. You get new ones tomorrow.",
  });
  assertEquals(state.claudeCalls.length, 2);
});

Deno.test('kill switch, bad form, not signed in, no exercises for the equipment', async () => {
  const off = setup({ enabled: false });
  assertEquals((await handle(post(request), off.deps)).status, 503);
  assertEquals(off.state.claudeCalls.length, 0);

  const { deps, state } = setup();
  assertEquals((await handle(post(request, 'Bearer nope'), deps)).status, 401);
  for (const bad of [
    { ...request, goal: 'bulk' },
    { ...request, days_per_week: 7 },
    { ...request, session_minutes: 50 },
    { ...request, equipment: 'kettlebells' },
  ]) {
    assertEquals((await handle(post(bad), deps)).status, 400);
  }
  const none = await handle(post({ ...request, equipment: 'bodyweight' }), deps);
  assertEquals(none.status, 422);
  assertEquals(state.claudeCalls.length, 0);
  assertEquals(state.used, 0); // the failed reservation was released
});

Deno.test('timeouts give a clear message and are logged', async () => {
  const timeout = Object.assign(new Error('Request timed out.'), {
    name: 'APIConnectionTimeoutError',
  });
  const { deps, state } = setup({ answers: [timeout] });
  const res = await handle(post(request), deps);
  assertEquals(res.status, 504);
  assertEquals(state.finished[0]!.p_status, 'error');
});

Deno.test('the plan prompt is long enough to be cached and has no changing parts', () => {
  assert(PLAN_PROMPT.length > 2600, `plan prompt is ${PLAN_PROMPT.length} characters`);
  assert(!/\d{4}-\d{2}-\d{2}/.test(PLAN_PROMPT));
});
