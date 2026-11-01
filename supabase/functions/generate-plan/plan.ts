// The plan generator's fixed prompt, answer schema and checks. No imports
// from Deno or npm, so it's tested with a fake Claude.

export const GOALS = ['strength', 'hypertrophy', 'fat_loss', 'general_fitness'] as const;
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const EQUIPMENT = ['full_gym', 'home_dumbbells', 'bodyweight'] as const;
export const SESSION_MINUTES = [30, 45, 60, 75, 90] as const;

export type PlanRequest = {
  goal: (typeof GOALS)[number];
  experience: (typeof LEVELS)[number];
  days_per_week: number;
  session_minutes: number;
  equipment: (typeof EQUIPMENT)[number];
};

/** The form's answers, or why they aren't valid. */
export function parseRequest(
  body: unknown,
): { ok: true; value: PlanRequest } | { ok: false; reason: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!GOALS.includes(b.goal as PlanRequest['goal'])) return { ok: false, reason: 'Pick a goal.' };
  if (!LEVELS.includes(b.experience as PlanRequest['experience']))
    return { ok: false, reason: 'Pick your experience.' };
  const days = Number(b.days_per_week);
  if (!Number.isInteger(days) || days < 2 || days > 6)
    return { ok: false, reason: 'Pick 2 to 6 days a week.' };
  const minutes = Number(b.session_minutes);
  if (!SESSION_MINUTES.includes(minutes as (typeof SESSION_MINUTES)[number]))
    return { ok: false, reason: 'Pick a session length.' };
  if (!EQUIPMENT.includes(b.equipment as PlanRequest['equipment']))
    return { ok: false, reason: 'Pick your equipment.' };
  return {
    ok: true,
    value: {
      goal: b.goal as PlanRequest['goal'],
      experience: b.experience as PlanRequest['experience'],
      days_per_week: days,
      session_minutes: minutes,
      equipment: b.equipment as PlanRequest['equipment'],
    },
  };
}

/**
 * Fixed system prompt (no dates, no user data), so it's cached. Claude Haiku
 * 5.5 caches prefixes of 512+ tokens; this one is above that.
 */
export const PLAN_PROMPT = `You are the program designer inside LightweightBaby, a gym tracking app. You write one multi-week training plan for one lifter, as JSON. The app turns your answer into workout templates the lifter follows, so every exercise must come from the exercise list in the message.

The message has four parts:
- Request: goal (strength, hypertrophy, fat_loss or general_fitness), experience (beginner, intermediate or advanced), days per week, session length in minutes, and equipment (full_gym, home_dumbbells or bodyweight).
- Athlete: goal, experience, planned days and bodyweight from the lifter's profile, in their unit ("kg" or "lbs").
- History: a summary of the last 8 weeks: sessions, average sessions per week and minutes, the most trained lifts with their best set and estimated one-rep max (e1RM), and working sets per week by muscle. It can be empty for a new lifter.
- Exercises: the only exercises you may use, one per line as "<id> <name> [<main muscle>]", for example "e12 Bench Press (Barbell) [chest]".

How to build the plan:
- Make exactly as many days as the request's days per week. Name each day by its content ("Upper A", "Lower B", "Push", "Full body 1"), not by weekday.
- Pick a split that fits the days: 2-3 days full body; 4 days upper/lower; 5-6 days push/pull/legs or upper/lower plus full body. Train each major muscle group (chest, back, shoulders, quads, hamstrings or glutes) at least twice a week when there are 3 or more days.
- Fit the session length: count about 2.5 minutes per working set for compound lifts and 2 minutes for isolation work, including rest. 30 minutes is about 12 sets, 45 about 16, 60 about 20, 75 about 24, 90 about 28. Use 3 to 8 exercises per day.
- Start each day with the main compound lifts, then accessories, then isolation and core work.
- Goal: strength uses 3-6 reps on the main lifts with 120-240 s rest and 6-10 reps on accessories; hypertrophy uses 6-12 reps (10-15 for isolation) with 60-120 s rest and about 10-20 sets per muscle per week; fat_loss and general_fitness use 8-15 reps with 45-90 s rest and more full-body work.
- Experience: beginners get fewer exercises, simple movements, 2-3 sets each and steady weekly progression; advanced lifters get more volume and variation. Don't give a beginner more than about 12 sets per muscle per week.
- Use the history: keep lifts the lifter already does well, add work for muscles with few sets, and don't jump weekly volume far above what they did recently (about 30% more at most).
- Use each exercise at most once per day. Prefer exercises that match the equipment; the list is already filtered to it.
- "weeks" is how long to run the plan before changing it, 4 to 12 (usually 6-8). "progression" says in one or two sentences how to add weight or reps from week to week, and when to take a lighter week.
- "notes": up to 3 short, practical tips (warm-up sets, technique, recovery). No medical advice; if a tip is about pain, it says to stop the movement and see a physiotherapist or doctor.

Rules:
- Use only ids from the exercise list, exactly as written (for example "e12"). Never invent an id or an exercise.
- sets 1 to 6; reps_min and reps_max 1 to 30 with reps_min <= reps_max (same number for a fixed target); rest_seconds 30 to 300.
- Short texts in plain language: name up to 40 characters, day names up to 30, each focus up to 80, description up to 300, progression up to 300, each note up to 160. No emojis, no hype.
- Answer with the JSON object only, matching the schema exactly.`;

export const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Program name, e.g. "3-day full body".' },
    description: {
      type: 'string',
      description: 'One or two sentences: who it is for, how it works.',
    },
    weeks: { type: 'integer', description: 'Weeks to run it, 4 to 12.' },
    progression: { type: 'string', description: 'How to progress week to week.' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          focus: { type: 'string', description: 'What the day trains, one short sentence.' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'An id from the exercise list, e.g. "e12".' },
                sets: { type: 'integer' },
                reps_min: { type: 'integer' },
                reps_max: { type: 'integer' },
                rest_seconds: { type: 'integer' },
              },
              required: ['id', 'sets', 'reps_min', 'reps_max', 'rest_seconds'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'focus', 'exercises'],
        additionalProperties: false,
      },
    },
    notes: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short tips.' },
  },
  required: ['name', 'description', 'weeks', 'progression', 'days', 'notes'],
  additionalProperties: false,
};

export type PlanAnswer = {
  name: string;
  description: string;
  weeks: number;
  progression: string;
  days: {
    name: string;
    focus: string;
    exercises: {
      id: string;
      sets: number;
      reps_min: number;
      reps_max: number;
      rest_seconds: number;
    }[];
  }[];
  notes: string[];
};

/** What the app gets: real exercise ids and names instead of e1, e2… */
export type Plan = {
  name: string;
  description: string;
  weeks: number;
  progression: string;
  notes: string[];
  days: {
    name: string;
    focus: string;
    exercises: {
      exercise_id: string;
      name: string;
      sets: number;
      reps_min: number;
      reps_max: number;
      rest_seconds: number;
    }[];
  }[];
};

const isInt = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * Parses and checks Claude's plan. An unknown exercise id (or any other
 * problem) gives a reason, which is sent back to Claude for the one retry.
 */
export function checkPlan(
  text: string,
  opts: { days: number; ids: Record<string, string> },
): { ok: true; value: PlanAnswer } | { ok: false; reason: string } {
  let v: PlanAnswer;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v))
    return { ok: false, reason: 'not an object' };
  if (!isText(v.name, 60))
    return { ok: false, reason: 'name missing or longer than 40 characters' };
  if (!isText(v.description, 400)) return { ok: false, reason: 'description missing or too long' };
  if (!isText(v.progression, 400)) return { ok: false, reason: 'progression missing or too long' };
  if (!isInt(v.weeks, 1, 16)) return { ok: false, reason: 'weeks must be 4 to 12' };
  if (!Array.isArray(v.notes) || v.notes.length > 3 || v.notes.some((n) => !isText(n, 200)))
    return { ok: false, reason: 'notes must be up to 3 short texts' };
  if (!Array.isArray(v.days) || v.days.length !== opts.days)
    return { ok: false, reason: `the plan needs exactly ${opts.days} days` };
  for (const [d, day] of v.days.entries()) {
    const where = `day ${d + 1}`;
    if (!isText(day?.name, 40)) return { ok: false, reason: `${where} name missing or too long` };
    if (typeof day.focus !== 'string' || day.focus.length > 120)
      return { ok: false, reason: `${where} focus too long` };
    if (!Array.isArray(day.exercises) || day.exercises.length < 3 || day.exercises.length > 8)
      return { ok: false, reason: `${where} needs 3 to 8 exercises` };
    const seen = new Set<string>();
    for (const ex of day.exercises) {
      if (!ex || typeof ex.id !== 'string' || !Object.hasOwn(opts.ids, ex.id)) {
        return {
          ok: false,
          reason: `unknown exercise id "${String(ex?.id)}" in ${where}; use only ids from the exercise list`,
        };
      }
      if (seen.has(ex.id)) return { ok: false, reason: `${ex.id} is used twice in ${where}` };
      seen.add(ex.id);
      if (!isInt(ex.sets, 1, 6)) return { ok: false, reason: `${ex.id} sets must be 1 to 6` };
      if (!isInt(ex.reps_min, 1, 30) || !isInt(ex.reps_max, 1, 30) || ex.reps_min > ex.reps_max)
        return { ok: false, reason: `${ex.id} reps must be 1 to 30 with reps_min <= reps_max` };
      if (!isInt(ex.rest_seconds, 30, 300))
        return { ok: false, reason: `${ex.id} rest_seconds must be 30 to 300` };
    }
  }
  return { ok: true, value: v };
}

/** Swaps the short ids for real exercise ids and names. */
export function toPlan(
  answer: PlanAnswer,
  ids: Record<string, string>,
  names: Record<string, string>,
): Plan {
  return {
    name: answer.name.trim(),
    description: answer.description.trim(),
    weeks: answer.weeks,
    progression: answer.progression.trim(),
    notes: answer.notes.map((n) => n.trim()),
    days: answer.days.map((day) => ({
      name: day.name.trim(),
      focus: day.focus.trim(),
      exercises: day.exercises.map((ex) => ({
        exercise_id: ids[ex.id]!,
        name: names[ex.id] ?? '',
        sets: ex.sets,
        reps_min: ex.reps_min,
        reps_max: ex.reps_max,
        rest_seconds: ex.rest_seconds,
      })),
    })),
  };
}

/** The user message: the request, then the summary, then the exercise list. */
export function planMessage(
  request: PlanRequest,
  prompt: { athlete?: unknown; history?: unknown; exercises: string[] },
): string {
  return [
    `Request: ${JSON.stringify(request)}`,
    `Athlete: ${JSON.stringify(prompt.athlete ?? {})}`,
    `History: ${JSON.stringify(prompt.history ?? {})}`,
    'Exercises:',
    ...prompt.exercises,
  ].join('\n');
}
