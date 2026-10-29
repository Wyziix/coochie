// Shared by workout-feedback and weekly-report. No Deno/npm imports, so the
// handlers can be tested with a fake Claude (no API calls, no cost).

export type Kind = 'workout_feedback' | 'weekly_report';

export type ClaudeRequest = {
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  schema: Record<string, unknown>;
};

export type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number };

export type ClaudeResponse = {
  text: string;
  stopReason: string | null;
  usage: Usage;
};

/** Sends one Messages API request (index.ts uses the Anthropic SDK). */
export type Claude = (req: ClaudeRequest) => Promise<ClaudeResponse>;

/**
 * Fixed system prompt for both tasks. It never changes between requests (no
 * dates, no user data), so it's cached: Claude Haiku 5.5 caches prefixes of
 * 512+ tokens, and this one is above that.
 */
export const SYSTEM_PROMPT = `You are the training analyst inside LightweightBaby, a gym tracking app. You write short, specific feedback for one lifter, based only on the training data in the message. The data is a compact JSON summary computed by the app's server: weights are already in the lifter's unit (field "units": "kg" or "lbs"), e1RM is the estimated one-rep max (Epley formula), "volume" is weight × reps of working sets (warm-ups excluded), and "sets_by_muscle" counts working sets per muscle (the main muscle counts 1, each secondary muscle 0.5).

There are two tasks. The message starts with "Task: workout_feedback" or "Task: weekly_report".

workout_feedback: feedback on the workout just finished.
- Compare each main exercise with "previous_sessions": say whether the top set, e1RM or volume went up, stayed level or went down, with the actual numbers (for example "Bench top set 90x5, up from 85x5 last week").
- Mention new personal records from "new_records" by name and number.
- Look at muscle balance this week ("this_week.sets_by_muscle"): point out a clear imbalance, such as lots of pushing and no pulling, or no leg work.
- Look for risk: a weekly volume jump of roughly 30% or more over the previous weeks, the same muscle trained hard on back-to-back days, or performance dropping across several sessions. Mention possible overtraining only when the data shows it.
- Give one or two concrete suggestions for next time: a weight, rep or set target for a named exercise, or one exercise to add. No vague advice.
- If there is no previous data for an exercise, say this session is the baseline.

weekly_report: a summary of one training week (Monday to Sunday).
- Consistency: sessions done versus "planned_days_per_week", and compared with previous weeks.
- Volume trend: total volume versus the previous weeks, with numbers.
- Highlights: personal records and clear e1RM progress from "top_exercises".
- Focus for next week: one to three specific, doable points based on the data (balance, progression, recovery).

Rules for both tasks:
- Use only numbers that appear in the data. Never invent sessions, weights or records. If something isn't in the data, don't mention it.
- Be brief and specific. Plain, friendly language, second person ("you"). No generic motivation ("great job", "keep pushing", "you've got this"), no emojis, no exclamation marks, no filler.
- Every list item is one short sentence. Leave a list empty rather than padding it.
- Respect the lifter's goal and experience: strength goals focus on top sets and e1RM, hypertrophy on sets and volume per muscle, beginners on consistency and technique.
- You are not a doctor. Never diagnose an injury or condition, and never give medical treatment advice. If the notes mention pain, injury, dizziness or anything health-related, set "see_professional" to true, add a warning that suggests stopping the painful movement and seeing a physiotherapist or doctor, and don't push for more load on that movement. Otherwise "see_professional" is false.
- Write numbers with their unit, using the lifter's unit.
- Answer with the JSON object only, matching the schema exactly.`;

const list = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

export const SCHEMAS: Record<Kind, Record<string, unknown>> = {
  workout_feedback: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One or two sentences on how the session went versus previous ones.',
      },
      positives: list('Up to 3 things that improved, with numbers.'),
      warnings: list('Up to 3 risks from the data (volume jump, imbalance, pain). Often empty.'),
      suggestions: list('1 or 2 concrete targets for next time.'),
      see_professional: { type: 'boolean' },
    },
    required: ['summary', 'positives', 'warnings', 'suggestions', 'see_professional'],
    additionalProperties: false,
  },
  weekly_report: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Two or three sentences on the week.' },
      consistency: {
        type: 'string',
        description: 'Sessions done versus planned, versus previous weeks.',
      },
      volume_trend: {
        type: 'string',
        description: 'Total volume versus previous weeks, with numbers.',
      },
      highlights: list('Up to 4 PRs or clear progress, with numbers.'),
      focus_next_week: list('1 to 3 specific points for next week.'),
      warnings: list('Up to 3 risks from the data. Often empty.'),
      see_professional: { type: 'boolean' },
    },
    required: [
      'summary',
      'consistency',
      'volume_trend',
      'highlights',
      'focus_next_week',
      'warnings',
      'see_professional',
    ],
    additionalProperties: false,
  },
};

export type WorkoutFeedback = {
  summary: string;
  positives: string[];
  warnings: string[];
  suggestions: string[];
  see_professional: boolean;
};

export type WeeklyReport = {
  summary: string;
  consistency: string;
  volume_trend: string;
  highlights: string[];
  focus_next_week: string[];
  warnings: string[];
  see_professional: boolean;
};

// Limits the schema can't express (structured outputs don't support lengths),
// checked here: [min items, max items] and the longest text allowed.
const LIMITS: Record<
  Kind,
  { text: Record<string, number>; lists: Record<string, [number, number]> }
> = {
  workout_feedback: {
    text: { summary: 400 },
    lists: { positives: [0, 3], warnings: [0, 3], suggestions: [1, 2] },
  },
  weekly_report: {
    text: { summary: 600, consistency: 300, volume_trend: 300 },
    lists: { highlights: [0, 4], focus_next_week: [1, 3], warnings: [0, 3] },
  },
};
const ITEM_MAX = 220;

/** The parsed answer, or why it isn't usable. */
export function validate(
  kind: Kind,
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, reason: 'not an object' };
  const v = value as Record<string, unknown>;
  const { text: texts, lists } = LIMITS[kind];
  for (const [key, max] of Object.entries(texts)) {
    const s = v[key];
    if (typeof s !== 'string' || !s.trim()) return { ok: false, reason: `${key} missing` };
    if (s.length > max) return { ok: false, reason: `${key} longer than ${max} characters` };
  }
  for (const [key, [min, max]] of Object.entries(lists)) {
    const a = v[key];
    if (!Array.isArray(a) || a.some((x) => typeof x !== 'string' || !x.trim()))
      return { ok: false, reason: `${key} is not a list of text` };
    if (a.length < min || a.length > max)
      return { ok: false, reason: `${key} needs ${min} to ${max} items` };
    if (a.some((x: string) => x.length > ITEM_MAX))
      return { ok: false, reason: `${key} item longer than ${ITEM_MAX} characters` };
  }
  if (typeof v.see_professional !== 'boolean')
    return { ok: false, reason: 'see_professional missing' };
  const allowed = new Set([...Object.keys(texts), ...Object.keys(lists), 'see_professional']);
  if (Object.keys(v).some((k) => !allowed.has(k)))
    return { ok: false, reason: 'unexpected fields' };
  return { ok: true, value: v };
}

export type GenerateResult =
  | { ok: true; content: Record<string, unknown>; usage: Usage; attempts: number }
  | { ok: false; reason: string; usage: Usage; attempts: number };

/**
 * Asks Claude, checks the answer, and asks once more if it isn't valid
 * (telling it what was wrong). Errors from the API itself are thrown.
 */
export async function generate(
  claude: Claude,
  kind: Kind,
  model: string,
  maxTokens: number,
  context: unknown,
): Promise<GenerateResult> {
  const usage: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const base = `Task: ${kind}\nData (JSON):\n${JSON.stringify(context)}`;
  let reason = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user =
      attempt === 1
        ? base
        : `${base}\n\nYour previous answer couldn't be used (${reason}). Answer again with the JSON object only, keeping every text short.`;
    const res = await claude({
      model,
      maxTokens,
      system: SYSTEM_PROMPT,
      user,
      schema: SCHEMAS[kind],
    });
    usage.input += res.usage.input;
    usage.output += res.usage.output;
    usage.cacheWrite += res.usage.cacheWrite;
    usage.cacheRead += res.usage.cacheRead;
    if (res.stopReason === 'refusal') {
      reason = 'refused';
    } else if (res.stopReason === 'max_tokens') {
      reason = 'answer was cut off';
    } else {
      const checked = validate(kind, res.text);
      if (checked.ok) return { ok: true, content: checked.value, usage, attempts: attempt };
      reason = checked.reason;
    }
  }
  return { ok: false, reason, usage, attempts: 2 };
}

/** Message for each reason ai_reserve can refuse, and its HTTP status. */
export function refusal(
  reason: string,
  limit?: number,
): { status: number; error: string; message: string } {
  switch (reason) {
    case 'limit':
      return {
        status: 429,
        error: 'limit',
        message: `You've used your ${limit ?? 3} AI requests for today. You get new ones tomorrow.`,
      };
    case 'disabled':
      return { status: 503, error: 'disabled', message: 'AI features are switched off right now.' };
    case 'budget':
      return {
        status: 503,
        error: 'budget',
        message:
          'AI is paused for today because the daily spending limit was reached. It’s back tomorrow.',
      };
    case 'in_progress':
      return {
        status: 409,
        error: 'in_progress',
        message: 'Already working on it. Give it a few seconds.',
      };
    default:
      return { status: 503, error: reason, message: 'AI isn’t available right now.' };
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const isTimeout = (error: unknown) =>
  error instanceof Error && /timed? ?out|timeout|abort/i.test(`${error.name} ${error.message}`);
