import type { Exercise, ExerciseInput } from '@/lib/api/exercises';
import type { Template, TemplatePayload } from '@/lib/api/templates';
import type { SavePayload, WorkoutDetail, WorkoutSet, WorkoutSummary } from '@/lib/api/workouts';

import type { OutboxItem } from './outbox';

// Queued changes shown on top of what the server (or the cached copy) has, so
// the app looks the same offline as online. Pure functions.

/** Not on the server yet ('waiting'), or refused by it ('failed'). */
export type SyncMark = { sync?: 'waiting' | 'failed' };

type SetJson = Pick<
  WorkoutSet,
  | 'id'
  | 'exercise_id'
  | 'exercise_order'
  | 'set_order'
  | 'set_type'
  | 'weight_kg'
  | 'reps'
  | 'rpe'
  | 'duration_seconds'
  | 'distance_m'
>;

type Change<T> = { deleted: true } | { deleted: false; payload: T; item: OutboxItem };

/** The latest queued change per entity. A delete the server refused isn't applied. */
function changes<T>(items: OutboxItem[], save: string, del: string) {
  const map = new Map<string, Change<T>>();
  for (const i of items) {
    if (i.kind === save) map.set(i.entityId, { deleted: false, payload: i.payload as T, item: i });
    else if (i.kind === del && i.status !== 'failed') map.set(i.entityId, { deleted: true });
  }
  return map;
}

export const workoutChanges = (items: OutboxItem[]) =>
  changes<SavePayload>(items, 'save_workout', 'delete_workout');

const markOf = (item: OutboxItem): SyncMark['sync'] =>
  item.status === 'failed' ? 'failed' : 'waiting';

function workoutRow(p: SavePayload, item: OutboxItem): WorkoutSummary & SyncMark {
  const w = p.p_workout;
  const sets = p.p_sets as unknown as SetJson[];
  const volume = sets
    .filter((s) => s.set_type !== 'warmup')
    .reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  return {
    id: w.id,
    user_id: item.userId,
    name: w.name,
    started_at: w.started_at,
    ended_at: w.ended_at,
    duration_seconds: Math.max(
      0,
      Math.floor((Date.parse(w.ended_at) - Date.parse(w.started_at)) / 1000),
    ),
    total_volume_kg: Math.round(volume * 100) / 100,
    notes: null,
    template_id: w.template_id,
    created_at: item.changedAt,
    updated_at: item.changedAt,
    client_updated_at: item.changedAt,
    set_count: sets.length,
    sync: markOf(item),
  };
}

/** A queued workout as the detail screen shows it. */
export function workoutDetailFromChange(
  p: SavePayload,
  item: OutboxItem,
  exercises: Map<string, Pick<Exercise, 'id' | 'name' | 'type'>>,
): WorkoutDetail & SyncMark {
  const { set_count: _count, ...row } = workoutRow(p, item);
  const sets = (p.p_sets as unknown as SetJson[]).map((s) => ({
    ...s,
    workout_id: row.id,
    user_id: item.userId,
    created_at: item.changedAt,
    updated_at: item.changedAt,
    exercise: exercises.get(s.exercise_id) ?? {
      id: s.exercise_id,
      name: 'Exercise',
      type: 'weights' as const,
    },
  }));
  sets.sort((a, b) => a.exercise_order - b.exercise_order || a.set_order - b.set_order);
  return { ...row, sets };
}

/**
 * Workout list with queued saves and deletes applied. New workouts are added
 * only when `insertNew` (e.g. to the first history page), and only if they
 * pass `include` (e.g. the calendar month).
 */
export function overlayWorkouts(
  list: WorkoutSummary[] | undefined,
  items: OutboxItem[],
  {
    insertNew = true,
    include,
  }: { insertNew?: boolean; include?: (w: WorkoutSummary) => boolean } = {},
): (WorkoutSummary & SyncMark)[] {
  const map = workoutChanges(items);
  const out: (WorkoutSummary & SyncMark)[] = [];
  for (const w of list ?? []) {
    const c = map.get(w.id);
    if (c?.deleted) continue;
    const row = c ? workoutRow(c.payload, c.item) : w;
    if (!c || !include || include(row)) out.push(row);
  }
  if (insertNew) {
    for (const [id, c] of map) {
      if (c.deleted || out.some((w) => w.id === id) || list?.some((w) => w.id === id)) continue;
      const row = workoutRow(c.payload, c.item);
      if (!include || include(row)) out.push(row);
    }
  }
  return out.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

type TemplateExerciseJson = {
  exercise_id: string;
  target_sets: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_duration_seconds: number | null;
  rest_seconds: number | null;
};

/** Templates with queued saves and deletes applied. */
export function overlayTemplates(
  list: Template[] | undefined,
  items: OutboxItem[],
  exercises: Map<string, Exercise>,
): (Template & SyncMark)[] {
  const map = changes<TemplatePayload>(items, 'save_template', 'delete_template');
  const build = (
    id: string,
    c: Extract<Change<TemplatePayload>, { deleted: false }>,
    old?: Template,
  ) => {
    const t = c.payload.p_template as { name: string; notes: string | null };
    const rows = c.payload.p_exercises as unknown as TemplateExerciseJson[];
    return {
      id,
      owner_id: c.item.userId,
      name: t.name,
      notes: t.notes,
      program: null,
      position: 0,
      is_hidden: false,
      created_at: old?.created_at ?? c.item.changedAt,
      updated_at: c.item.changedAt,
      client_updated_at: c.item.changedAt,
      sync: markOf(c.item),
      exercises: rows.map((e, position) => {
        const x = exercises.get(e.exercise_id);
        return {
          id: `${id}-${position}`,
          template_id: id,
          position,
          ...e,
          exercise: {
            id: e.exercise_id,
            name: x?.name ?? 'Exercise',
            type: x?.type ?? 'weights',
            primary_muscle: x?.primary_muscle ?? 'chest',
            default_rest_seconds: x?.default_rest_seconds ?? 90,
            is_hidden: x?.is_hidden ?? false,
          },
        };
      }),
    } satisfies Template & SyncMark;
  };
  const out: (Template & SyncMark)[] = [];
  for (const t of list ?? []) {
    const c = map.get(t.id);
    if (c?.deleted) continue;
    out.push(c ? build(t.id, c, t) : t);
  }
  for (const [id, c] of map) {
    if (!c.deleted && !out.some((t) => t.id === id)) out.push(build(id, c));
  }
  return out;
}

/** Custom exercises created or edited offline. */
export function overlayExercises(list: Exercise[] | undefined, items: OutboxItem[]): Exercise[] {
  let out = list ?? [];
  for (const i of items) {
    if (i.kind !== 'save_exercise') continue;
    const input = i.payload as ExerciseInput;
    const old = out.find((e) => e.id === i.entityId);
    const row: Exercise = {
      ...(old ?? {
        id: i.entityId,
        owner_id: i.userId,
        slug: null,
        is_hidden: false,
        created_at: i.changedAt,
      }),
      ...input,
      updated_at: i.changedAt,
    } as Exercise;
    out = old ? out.map((e) => (e.id === row.id ? row : e)) : [...out, row];
  }
  return out === list ? out : [...out].sort((a, b) => a.name.localeCompare(b.name));
}

/** Rest times changed offline. */
export function overlayRest(map: Record<string, number> | undefined, items: OutboxItem[]) {
  const pending = items.filter((i) => i.kind === 'save_rest');
  if (pending.length === 0) return map;
  const out = { ...map };
  for (const i of pending) out[i.entityId] = (i.payload as { seconds: number }).seconds;
  return out;
}
