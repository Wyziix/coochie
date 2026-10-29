import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';
import type { toSavePayload } from '@/lib/workout/payload';

export type Workout = Tables<'workouts'>;
export type WorkoutSet = Tables<'workout_sets'>;
export type WorkoutSummary = Workout & { set_count: number };
export type WorkoutDetail = Workout & {
  sets: (WorkoutSet & { exercise: Pick<Tables<'exercises'>, 'id' | 'name' | 'type'> })[];
};

export async function saveWorkout(payload: ReturnType<typeof toSavePayload>): Promise<Workout> {
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
  return data.map(({ workout_sets, ...w }) => ({
    ...w,
    set_count: (workout_sets as unknown as { count: number }[])[0]?.count ?? 0,
  }));
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
