// POST { workout_id, regenerate? } with the user's JWT → feedback on that
// workout. Saved feedback is returned without a new call; the daily limit,
// kill switch and spending cap are checked by ai_reserve() in the database
// before Claude is called. Testable with fakes (handler.test.ts).
import { type Claude, corsHeaders, generate, isTimeout, json, refusal } from '../_shared/ai.ts';

export type FeedbackRow = {
  id: string;
  content: unknown;
  created_at: string;
  source_updated_at: string | null;
};

export type Deps = {
  /** The signed-in user (checked with Supabase Auth), or null. */
  userIdFromAuth(authorization: string): Promise<string | null>;
  /** Service-role database function call; throws on error. */
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** Saved feedback for this workout, and when the workout last changed. */
  existing(
    userId: string,
    workoutId: string,
  ): Promise<{ feedback: FeedbackRow | null; workoutUpdatedAt: string | null }>;
  claude: Claude;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Reservation =
  | { ok: true; id: string; model: string; max_tokens: number }
  | { ok: false; reason: string; limit?: number };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method', message: 'Method not allowed' }, 405);

  const userId = await deps
    .userIdFromAuth(req.headers.get('authorization') ?? '')
    .catch(() => null);
  if (!userId) return json({ error: 'auth', message: 'Sign in again.' }, 401);

  const body = (await req.json().catch(() => null)) as {
    workout_id?: string;
    regenerate?: boolean;
  } | null;
  const workoutId = body?.workout_id ?? '';
  if (!UUID.test(workoutId))
    return json({ error: 'bad_request', message: 'Missing workout.' }, 400);

  // Already have it? Reopening costs nothing. A new one only if the workout
  // was edited since.
  const { feedback, workoutUpdatedAt } = await deps.existing(userId, workoutId);
  if (!workoutUpdatedAt) {
    return json(
      {
        error: 'not_found',
        message: 'Workout not found. If you logged it offline, wait until it has synced.',
      },
      404,
    );
  }
  const stale =
    !!feedback && !!feedback.source_updated_at && workoutUpdatedAt > feedback.source_updated_at;
  if (feedback && !(body?.regenerate && stale)) return json({ feedback, cached: true, stale });

  const r = await deps.rpc<Reservation>('ai_reserve', {
    p_user: userId,
    p_function: 'workout_feedback',
    p_ref: workoutId,
    p_counts: true,
  });
  if (!r.ok) {
    const { status, ...rest } = refusal(r.reason, r.limit);
    return json(rest, status);
  }

  let attempts = 0;
  try {
    const context = await deps.rpc<unknown>('ai_workout_context', {
      p_user: userId,
      p_workout: workoutId,
    });
    if (!context) {
      await finish(deps, r.id, 'error', undefined, 0, 'workout not found');
      return json({ error: 'not_found', message: 'Workout not found.' }, 404);
    }
    const result = await generate(deps.claude, 'workout_feedback', r.model, r.max_tokens, context);
    attempts = result.attempts;
    if (!result.ok) {
      await finish(deps, r.id, 'error', result.usage, attempts, `invalid output: ${result.reason}`);
      return json(
        {
          error: 'invalid_output',
          message: 'Couldn’t get usable feedback this time. Try again later.',
        },
        502,
      );
    }
    await finish(deps, r.id, 'ok', result.usage, attempts);
    const saved = await deps.rpc<FeedbackRow>('ai_save_feedback', {
      p_user: userId,
      p_kind: 'workout',
      p_workout: workoutId,
      p_week_start: null,
      p_content: result.content,
      p_model: r.model,
    });
    return json({ feedback: saved, cached: false, stale: false });
  } catch (error) {
    await finish(
      deps,
      r.id,
      'error',
      undefined,
      Math.max(attempts, 1),
      String((error as Error)?.message ?? error),
    ).catch(() => {});
    if (isTimeout(error)) {
      return json(
        { error: 'timeout', message: 'Claude took too long to answer. Try again in a minute.' },
        504,
      );
    }
    return json(
      { error: 'ai_error', message: 'Claude couldn’t answer right now. Try again in a minute.' },
      502,
    );
  }
}

function finish(
  deps: Deps,
  id: string,
  status: 'ok' | 'error',
  usage?: { input: number; output: number; cacheWrite: number; cacheRead: number },
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
