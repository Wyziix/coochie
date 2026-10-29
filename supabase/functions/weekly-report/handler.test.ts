// deno test supabase/functions. Claude and Expo push are faked.
import { assertEquals } from 'jsr:@std/assert@1';

import type { ClaudeResponse } from '../_shared/ai.ts';
import { type Deps, handle, type PushMessage } from './handler.ts';

const report = {
  summary: 'You trained 3 times this week, as planned, and volume rose 8%.',
  consistency: '3 of 3 planned sessions, up from 2 last week.',
  volume_trend: '12,400 kg, up from 11,500 kg.',
  highlights: ['Bench 90x5, a new heaviest set.'],
  focus_next_week: ['Add one pulling exercise to balance the pushing.'],
  warnings: [],
  see_professional: false,
};
const answer = (content: unknown): ClaudeResponse => ({
  text: JSON.stringify(content),
  stopReason: 'end_turn',
  usage: { input: 900, output: 200, cacheWrite: 0, cacheRead: 650 },
});

function setup(opts: { users?: string[]; budgetAfter?: number; enabled?: boolean } = {}) {
  const users = opts.users ?? ['u1', 'u2', 'u3'];
  const state = {
    claimed: false,
    reserved: 0,
    saved: [] as Record<string, unknown>[],
    pushes: [] as PushMessage[],
    deleted: [] as string[],
    claudeCalls: 0,
    finishedRun: null as unknown,
    reserves: [] as Record<string, unknown>[],
  };
  const deps: Deps = {
    // deno-lint-ignore require-await
    async userIdFromAuth(a) {
      return a === 'Bearer admin-jwt' ? 'admin' : a === 'Bearer user-jwt' ? 'u1' : null;
    },
    // deno-lint-ignore require-await
    async isAdmin(a) {
      return a === 'Bearer admin-jwt';
    },
    // deno-lint-ignore require-await
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      switch (fn) {
        case 'ai_claim_weekly_run':
          if (args.p_token !== 'cron-token' || state.claimed)
            throw new Error('invalid or used run');
          state.claimed = true;
          return '2026-10-19' as T;
        case 'ai_last_week_start':
          return '2026-10-19' as T;
        case 'ai_weekly_candidates':
          return users as T;
        case 'ai_reserve':
          state.reserves.push(args);
          if (opts.enabled === false) return { ok: false, reason: 'disabled' } as T;
          if (opts.budgetAfter !== undefined && state.reserved >= opts.budgetAfter)
            return { ok: false, reason: 'budget' } as T;
          state.reserved++;
          return {
            ok: true,
            id: `r${state.reserved}`,
            model: 'claude-haiku-5-5',
            max_tokens: 700,
          } as T;
        case 'ai_week_context':
          return (args.p_user === 'empty' ? null : { week: { sessions: [{}] } }) as T;
        case 'ai_finish':
          return 0 as T;
        case 'ai_save_feedback': {
          const row = {
            id: `rep-${args.p_user}`,
            content: args.p_content,
            week_start: args.p_week_start,
            created_at: 'now',
          };
          state.saved.push({ ...args });
          return row as T;
        }
        case 'ai_finish_weekly_run':
          state.finishedRun = args.p_result;
          return null as T;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore require-await
    async claude(req) {
      state.claudeCalls++;
      if (req.maxTokens !== 700) throw new Error('weekly reports get 700 tokens');
      return answer(report);
    },
    // deno-lint-ignore require-await
    async pushTokens(userId) {
      return userId === 'u1' ? ['ExponentPushToken[ok]', 'ExponentPushToken[gone]'] : [];
    },
    // deno-lint-ignore require-await
    async sendPush(messages) {
      state.pushes.push(...messages);
      return messages.filter((m) => m.to.includes('gone')).map((m) => m.to);
    },
    // deno-lint-ignore require-await
    async deletePushTokens(tokens) {
      state.deleted.push(...tokens);
    },
  };
  return { deps, state };
}

const cron = (token = 'cron-token') =>
  new Request('http://fn/weekly-report', {
    method: 'POST',
    body: JSON.stringify({ run_id: 'run-1', token }),
  });
const adminTest = (auth: string) =>
  new Request('http://fn/weekly-report', {
    method: 'POST',
    headers: { authorization: auth },
    body: JSON.stringify({ mode: 'admin_test' }),
  });

Deno.test(
  'Monday run: a report for everyone who trained, push to Android, without using daily calls',
  async () => {
    const { deps, state } = setup();
    const res = await handle(cron(), deps);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      week: '2026-10-19',
      candidates: 3,
      generated: 3,
      errors: 0,
      stopped: null,
    });
    assertEquals(
      state.saved.map((s) => [s.p_user, s.p_kind, s.p_week_start]),
      [
        ['u1', 'weekly', '2026-10-19'],
        ['u2', 'weekly', '2026-10-19'],
        ['u3', 'weekly', '2026-10-19'],
      ],
    );
    assertEquals(
      state.reserves.every((r) => r.p_counts === false && r.p_function === 'weekly_report'),
      true,
    );
    assertEquals(state.pushes.length, 2);
    assertEquals(state.pushes[0]!.title, 'Your weekly report is ready');
    assertEquals(state.pushes[0]!.data, { url: '/reports/rep-u1' });
    assertEquals(state.deleted, ['ExponentPushToken[gone]']);
  },
);

Deno.test('the run only starts with the token from pg_cron, once', async () => {
  const { deps, state } = setup();
  assertEquals((await handle(cron('guess'), deps)).status, 403);
  assertEquals((await handle(cron(), deps)).status, 200);
  assertEquals((await handle(cron(), deps)).status, 403);
  assertEquals(state.claudeCalls, 3);
});

Deno.test('the spending cap stops the run for everyone', async () => {
  const { deps, state } = setup({ budgetAfter: 1 });
  const body = await (await handle(cron(), deps)).json();
  assertEquals(body.generated, 1);
  assertEquals(body.stopped, 'budget');
  assertEquals(state.reserves.length, 2); // stopped at the first refusal, didn't try u3
  assertEquals(state.finishedRun, body);
});

Deno.test('the kill switch stops it before any call', async () => {
  const { deps, state } = setup({ enabled: false });
  const body = await (await handle(cron(), deps)).json();
  assertEquals(body.stopped, 'disabled');
  assertEquals(state.claudeCalls, 0);
});

Deno.test('admin "Generate now": the admin’s current week; others are refused', async () => {
  const { deps, state } = setup();
  assertEquals((await handle(adminTest('Bearer user-jwt'), deps)).status, 403);
  assertEquals((await handle(adminTest('Bearer nope'), deps)).status, 401);
  const res = await handle(adminTest('Bearer admin-jwt'), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).report.week_start, '2026-10-26');
  assertEquals(state.saved[0]!.p_user, 'admin');
});
