import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';
import type { toSavePayload } from '@/lib/workout/payload';

/** save_workout arguments; the sync queue adds when the change was made. */
export type SavePayload = ReturnType<typeof toSavePayload> & {
  p_workout: { client_updated_at?: string };
};

export type Workout = Tables<'workouts'>;
export type WorkoutSet = Tables<'workout_sets'>;
export type WorkoutSummary = Workout & { set_count: number };
export type WorkoutDetail = Workout & {
  sets: (WorkoutSet & { exercise: Pick<Tables<'exercises'>, 'id' | 'name' | 'type'> })[];
};

const summarize = (rows: (Workout & { workout_sets: unknown })[]): WorkoutSummary[] =>
  rows.map(({ workout_sets, ...w }) => ({
    ...w,
    set_count: (workout_sets as { count: number }[])[0]?.count ?? 0,
  }));

/**
 * Null when the workout was deleted (on another device) after this change was
 * made; the stored row when a newer change already won.
 */
export async function saveWorkout(payload: SavePayload): Promise<Workout | null> {
  const { data, error } = await getSupabase().rpc('save_workout', payload);
  if (error) throw error;
  return data;
}

export async function fetchRecentWorkouts(limit = 5): Promise<WorkoutSummary[]> {
  const { data, error } = await getSupabase()
    .from('workouts')
    .select('*, workout_sets(count)')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return summarize(data);
}

export async function fetchWorkout(id: string): Promise<WorkoutDetail | null> {
  const { data, error } = await getSupabase()
    .from('workouts')
    .select('*, sets:workout_sets(*, exercise:exercises(id, name, type))')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const detail = data as unknown as WorkoutDetail;
  detail.sets.sort((a, b) => a.exercise_order - b.exercise_order || a.set_order - b.set_order);
  return detail;
}

/** One page of history, newest first. */
export async function fetchWorkoutsPage(page: number, pageSize = 20): Promise<WorkoutSummary[]> {
  const from = page * pageSize;
  const { data, error } = await getSupabase()
    .from('workouts')
    .select('*, workout_sets(count)')
    .order('started_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return summarize(data);
}

/** Workouts that started in [from, to), for the calendar. */
export async function fetchWorkoutsBetween(from: Date, to: Date): Promise<WorkoutSummary[]> {
  const { data, error } = await getSupabase()
    .from('workouts')
    .select('*, workout_sets(count)')
    .gte('started_at', from.toISOString())
    .lt('started_at', to.toISOString())
    .order('started_at', { ascending: false });
  if (error) throw error;
  return summarize(data);
}

/**
 * Server deletes the workout and its sets and recomputes anything derived
 * from it, unless it was edited after `deletedAt` (last write wins).
 */
export async function deleteWorkoutAt(id: string, deletedAt: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_workout_at', {
    p_id: id,
    p_deleted_at: deletedAt,
  });
  if (error) throw error;
}
