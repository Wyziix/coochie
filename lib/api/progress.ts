import { getSupabase } from '@/lib/supabase';
import type { Database, Tables } from '@/types/database';

type Fn<N extends keyof Database['public']['Functions']> = Database['public']['Functions'][N];

export type PersonalRecord = Tables<'personal_records'>;
export type NewRecord = Fn<'workout_records'>['Returns'][number];
export type HistoryPoint = Fn<'exercise_history'>['Returns'][number];
export type TrainedExercise = Fn<'trained_exercises'>['Returns'][number];
export type WeeklyOverview = {
  workouts: number;
  volume_kg: number;
  duration_seconds: number;
  sets: number;
  muscles: { muscle: Database['public']['Enums']['muscle_group']; sets: number }[];
};

/** New records the server computed for this workout (improvements only). */
export async function fetchWorkoutRecords(workoutId: string): Promise<NewRecord[]> {
  const { data, error } = await getSupabase().rpc('workout_records', { p_workout_id: workoutId });
  if (error) throw error;
  return data;
}

export async function fetchExerciseRecords(exerciseId: string): Promise<PersonalRecord[]> {
  const { data, error } = await getSupabase()
    .from('personal_records')
    .select('*')
    .eq('exercise_id', exerciseId);
  if (error) throw error;
  return data;
}

/** Most recent real improvements (not first-timers), for the Progress tab. */
export async function fetchRecentRecords(limit = 10) {
  const { data, error } = await getSupabase()
    .from('personal_records')
    .select('*, exercise:exercises(id, name, type)')
    .not('previous_value', 'is', null)
    .neq('record_type', 'reps_at_weight')
    .order('achieved_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as unknown as (PersonalRecord & {
    exercise: Pick<Tables<'exercises'>, 'id' | 'name' | 'type'>;
  })[];
}

export async function fetchExerciseHistory(exerciseId: string, since: Date | null) {
  const { data, error } = await getSupabase().rpc('exercise_history', {
    p_exercise_id: exerciseId,
    p_since: since ? since.toISOString() : null,
  });
  if (error) throw error;
  return data;
}

export async function fetchTrainedExercises(): Promise<TrainedExercise[]> {
  const { data, error } = await getSupabase().rpc('trained_exercises');
  if (error) throw error;
  return data;
}

export async function fetchWeeklyOverview(from: Date, to: Date): Promise<WeeklyOverview> {
  const { data, error } = await getSupabase().rpc('weekly_overview', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw error;
  return data as unknown as WeeklyOverview;
}
