import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

import type { Equipment, ExerciseType, MuscleGroup } from '@/lib/exercises/labels';

export type Exercise = Tables<'exercises'>;
export type LastSet = {
  exercise_id: string;
  set_index: number;
  set_type: Tables<'workout_sets'>['set_type'];
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  performed_at: string;
};

export type ExerciseInput = {
  name: string;
  primary_muscle: MuscleGroup;
  secondary_muscles: MuscleGroup[];
  equipment: Equipment;
  type: ExerciseType;
  instructions: string | null;
  default_rest_seconds: number;
};

export class DuplicateExerciseError extends Error {
  constructor() {
    super('An exercise with that name already exists');
  }
}

const rethrow = (error: { code?: string; message: string }): never => {
  if (error.code === '23505') throw new DuplicateExerciseError();
  throw error;
};

/** Global (including hidden) + the user's own custom exercises. */
export async function fetchExercises(): Promise<Exercise[]> {
  const { data, error } = await getSupabase().from('exercises').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createCustomExercise(
  userId: string,
  input: ExerciseInput,
): Promise<Exercise> {
  const { data, error } = await getSupabase()
    .from('exercises')
    .insert({ ...input, owner_id: userId })
    .select()
    .single();
  if (error) rethrow(error);
  return data!;
}

export async function updateCustomExercise(id: string, input: ExerciseInput): Promise<Exercise> {
  const { data, error } = await getSupabase()
    .from('exercises')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) rethrow(error);
  return data!;
}

/** Admin only; the server checks the role and logs the action. */
export async function adminSaveExercise(
  id: string | null,
  input: ExerciseInput,
): Promise<Exercise> {
  const { data, error } = await getSupabase().rpc('admin_save_exercise', {
    p_id: id,
    p_name: input.name,
    p_primary_muscle: input.primary_muscle,
    p_secondary_muscles: input.secondary_muscles,
    p_equipment: input.equipment,
    p_type: input.type,
    p_instructions: input.instructions,
    p_default_rest_seconds: input.default_rest_seconds,
  });
  if (error) rethrow(error);
  return data!;
}

export async function adminSetExerciseHidden(id: string, hidden: boolean): Promise<Exercise> {
  const { data, error } = await getSupabase().rpc('admin_set_exercise_hidden', {
    p_id: id,
    p_hidden: hidden,
  });
  if (error) throw error;
  return data;
}

export async function fetchRestSettings(): Promise<Record<string, number>> {
  const { data, error } = await getSupabase()
    .from('user_exercise_settings')
    .select('exercise_id, rest_seconds');
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.exercise_id, r.rest_seconds]));
}

export async function saveRestSetting(exerciseId: string, restSeconds: number): Promise<void> {
  const { error } = await getSupabase()
    .from('user_exercise_settings')
    .upsert({ exercise_id: exerciseId, rest_seconds: restSeconds });
  if (error) throw error;
}

export async function fetchLastSets(exerciseIds: string[]): Promise<LastSet[]> {
  if (exerciseIds.length === 0) return [];
  const { data, error } = await getSupabase().rpc('last_exercise_sets', {
    p_exercise_ids: exerciseIds,
  });
  if (error) throw error;
  return data;
}

/** Exercise ids from the user's most recent sets, newest first, no repeats. */
export async function fetchRecentExerciseIds(limit = 10): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from('workout_sets')
    .select('exercise_id')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return [...new Set(data.map((r) => r.exercise_id))].slice(0, limit);
}
