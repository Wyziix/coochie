// POST { goal, experience, days_per_week, session_minutes, equipment } with the
// user's JWT → a multi-week plan built only from library exercises. Nothing
// is saved here: the app shows a preview, and save_ai_plan() saves it as a
// program when the user accepts. Every call (a regenerate too) counts toward
// the daily plan limit. Testable with fakes (handler.test.ts).
import {
  askJson,
  type Claude,
  corsHeaders,
  finishCall,
  isTimeout,
  json,
  refusal,
  type Reservation,
  type Usage,
} from '../_shared/ai.ts';
import { checkPlan, parseRequest, PLAN_PROMPT, PLAN_SCHEMA, planMessage, toPlan } from './plan.ts';

export type Deps = {
  userIdFromAuth(authorization: string): Promise<string | null>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  claude: Claude;
};

type PlanContext = {
  prompt: { athlete?: unknown; history?: unknown; exercises: string[] };
  ids: Record<string, string>;
  names: Record<string, string>;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method', message: 'Method not allowed' }, 405);

  const userId = await deps
    .userIdFromAuth(req.headers.get('authorization') ?? '')
    .catch(() => null);
  if (!userId) return json({ error: 'auth', message: 'Sign in again.' }, 401);

  const parsed = parseRequest(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: 'bad_request', message: parsed.reason }, 400);
  const request = parsed.value;

  const r = await deps.rpc<Reservation>('ai_reserve', {
    p_user: userId,
    p_function: 'plan',
    p_ref: 'plan',
    p_counts: true,
  });
  if (!r.ok) {
    const { status, ...rest } = refusal(r.reason, r.limit, 'plan');
    return json(rest, status);
  }

  let usage: Usage | undefined;
  let attempts = 1;
  try {
    const context = await deps.rpc<PlanContext>('ai_plan_context', {
      p_user: userId,
      p_equipment: request.equipment,
    });
    if (!context?.prompt?.exercises?.length) {
      await finishCall(deps.rpc, r.id, 'error', undefined, 0, 'no exercises for this equipment');
      return json({ error: 'no_exercises', message: 'No exercises match that equipment.' }, 422);
    }
    const result = await askJson(deps.claude, {
      model: r.model,
      maxTokens: r.max_tokens,
      system: PLAN_PROMPT,
      schema: PLAN_SCHEMA,
      user: planMessage(request, context.prompt),
      check: (text) => checkPlan(text, { days: request.days_per_week, ids: context.ids }),
    });
    usage = result.usage;
    attempts = result.attempts;
    if (!result.ok) {
      await finishCall(
        deps.rpc,
        r.id,
        'error',
        usage,
        attempts,
        `invalid output: ${result.reason}`,
      );
      return json(
        {
          error: 'invalid_output',
          message: 'Couldn’t build a usable plan this time. Try again later.',
        },
        502,
      );
    }
    await finishCall(deps.rpc, r.id, 'ok', usage, attempts);
    return json({ plan: toPlan(result.content, context.ids, context.names ?? {}), request });
  } catch (error) {
    await finishCall(
      deps.rpc,
      r.id,
      'error',
      usage,
      attempts,
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
