// Weekly reports.
// - pg_cron (Mondays, catch-up Tue/Wed): POST { run_id, token } from
//   ai_start_weekly_run(); reports last week for everyone who trained and has
//   none yet. Stops when the kill switch is on or the spending cap is reached.
// - Admin "Generate now" (testing): POST { mode: "admin_test" } with an admin's
//   JWT; reports the admin's current week right away.
// Testable with fakes (handler.test.ts).
import {
  type Claude,
  corsHeaders,
  generate,
  isTimeout,
  json,
  refusal,
  type Usage,
} from '../_shared/ai.ts';

export type ReportRow = {
  id: string;
  content: { summary?: string };
  week_start: string;
  created_at: string;
};
export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export type Deps = {
  userIdFromAuth(authorization: string): Promise<string | null>;
  isAdmin(authorization: string): Promise<boolean>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  claude: Claude;
  pushTokens(userId: string): Promise<string[]>;
  /** Expo push; returns the tokens Expo says are no longer valid. */
  sendPush(messages: PushMessage[]): Promise<string[]>;
  deletePushTokens(tokens: string[]): Promise<void>;
};

type Reservation =
  | { ok: true; id: string; model: string; max_tokens: number }
  | { ok: false; reason: string; limit?: number };

/** Most users a single run handles (the rest are picked up by the next run). */
export const MAX_PER_RUN = 50;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method', message: 'Method not allowed' }, 405);
  const body = (await req.json().catch(() => null)) as {
    run_id?: string;
    token?: string;
    mode?: string;
  } | null;

  if (body?.mode === 'admin_test') {
    const authorization = req.headers.get('authorization') ?? '';
    const userId = await deps.userIdFromAuth(authorization).catch(() => null);
    if (!userId) return json({ error: 'auth', message: 'Sign in again.' }, 401);
    if (!(await deps.isAdmin(authorization).catch(() => false))) {
      return json({ error: 'forbidden', message: 'Admins only.' }, 403);
    }
    const lastWeek = await deps.rpc<string>('ai_last_week_start', {});
    const week = addDays(lastWeek, 7);
    const outcome = await reportFor(deps, userId, week);
    if (outcome.kind === 'refused') {
      const { status, ...rest } = refusal(outcome.reason);
      return json(rest, status);
    }
    if (outcome.kind === 'no_data') {
      return json(
        { error: 'no_data', message: 'No workouts this week yet, so there is nothing to report.' },
        404,
      );
    }
    if (outcome.kind === 'error') return json({ error: 'ai_error', message: outcome.message }, 502);
    return json({ report: outcome.report });
  }

  // Scheduled run: the token proves it came from pg_cron.
  let week: string;
  try {
    week = await deps.rpc<string>('ai_claim_weekly_run', {
      p_run: body?.run_id,
      p_token: body?.token,
    });
  } catch {
    return json({ error: 'forbidden', message: 'Invalid run.' }, 403);
  }
  const users = (await deps.rpc<string[]>('ai_weekly_candidates', { p_week_start: week })).slice(
    0,
    MAX_PER_RUN,
  );
  const result = {
    week,
    candidates: users.length,
    generated: 0,
    errors: 0,
    stopped: null as string | null,
  };
  for (const userId of users) {
    const outcome = await reportFor(deps, userId, week);
    if (outcome.kind === 'refused') {
      if (outcome.reason === 'in_progress') continue;
      result.stopped = outcome.reason; // kill switch or spending cap: stop for everyone
      break;
    }
    if (outcome.kind === 'generated') result.generated++;
    if (outcome.kind === 'error') result.errors++;
  }
  await deps.rpc('ai_finish_weekly_run', { p_run: body?.run_id, p_result: result }).catch(() => {});
  return json(result);
}

type Outcome =
  | { kind: 'generated'; report: ReportRow }
  | { kind: 'refused'; reason: string }
  | { kind: 'no_data' }
  | { kind: 'error'; message: string };

/** One user's report: reserve (doesn't use their daily calls), ask, save, notify. */
async function reportFor(deps: Deps, userId: string, week: string): Promise<Outcome> {
  const r = await deps.rpc<Reservation>('ai_reserve', {
    p_user: userId,
    p_function: 'weekly_report',
    p_ref: week,
    p_counts: false,
  });
  if (!r.ok) return { kind: 'refused', reason: r.reason };

  let usage: Usage | undefined;
  let attempts = 1;
  try {
    const context = await deps.rpc<unknown>('ai_week_context', {
      p_user: userId,
      p_week_start: week,
    });
    if (!context) {
      await finish(deps, r.id, 'error', undefined, 0, 'no workouts that week');
      return { kind: 'no_data' };
    }
    const result = await generate(deps.claude, 'weekly_report', r.model, r.max_tokens, context);
    usage = result.usage;
    attempts = result.attempts;
    if (!result.ok) {
      await finish(deps, r.id, 'error', usage, attempts, `invalid output: ${result.reason}`);
      return { kind: 'error', message: 'Couldn’t get a usable report this time. Try again later.' };
    }
    await finish(deps, r.id, 'ok', usage, attempts);
    const report = await deps.rpc<ReportRow>('ai_save_feedback', {
      p_user: userId,
      p_kind: 'weekly',
      p_workout: null,
      p_week_start: week,
      p_content: result.content,
      p_model: r.model,
    });
    await notify(deps, userId, report).catch(() => {});
    return { kind: 'generated', report };
  } catch (error) {
    await finish(
      deps,
      r.id,
      'error',
      usage,
      attempts,
      String((error as Error)?.message ?? error),
    ).catch(() => {});
    return {
      kind: 'error',
      message: isTimeout(error)
        ? 'Claude took too long to answer.'
        : 'Claude couldn’t answer right now.',
    };
  }
}

async function notify(deps: Deps, userId: string, report: ReportRow) {
  const tokens = await deps.pushTokens(userId);
  if (tokens.length === 0) return;
  const summary = String(report.content.summary ?? '');
  const invalid = await deps.sendPush(
    tokens.map((to) => ({
      to,
      title: 'Your weekly report is ready',
      body: summary.length > 110 ? `${summary.slice(0, 107)}…` : summary,
      data: { url: `/reports/${report.id}` },
    })),
  );
  if (invalid.length) await deps.deletePushTokens(invalid);
}

function finish(
  deps: Deps,
  id: string,
  status: 'ok' | 'error',
  usage?: Usage,
  attempts = 1,
  error?: string,
) {
  return deps.rpc('ai_finish', {
    p_id: id,
    p_status: status,
    p_input: usage?.input ?? 0,
    p_output: usage?.output ?? 0,
    p_cache_write: usage?.cacheWrite ?? 0,
    p_cache_read: usage?.cacheRead ?? 0,
    p_attempts: attempts,
    p_error: error ?? null,
  });
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
