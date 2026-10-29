import { getSupabase } from '@/lib/supabase';
import type { Json, Tables } from '@/types/database';

export type TemplateExercise = Tables<'template_exercises'> & {
  exercise: Pick<
    Tables<'exercises'>,
    'id' | 'name' | 'type' | 'primary_muscle' | 'default_rest_seconds' | 'is_hidden'
  >;
};
export type Template = Tables<'templates'> & { exercises: TemplateExercise[] };
export type TemplatePayload = { p_template: Json; p_exercises: Json };

/** Ready-made (incl. hidden ones for admins) and the user's own templates, exercises in order. */
export async function fetchTemplates(): Promise<Template[]> {
  const { data, error } = await getSupabase()
    .from('templates')
    .select(
      '*, exercises:template_exercises(*, exercise:exercises(id, name, type, primary_muscle, default_rest_seconds, is_hidden))',
    )
    .order('program', { nullsFirst: true })
    .order('position')
    .order('name');
  if (error) throw error;
  const templates = data as unknown as Template[];
  for (const t of templates) t.exercises.sort((a, b) => a.position - b.position);
  return templates;
}

/** The app picks the id of a new template, so a retried save can't create two. */
export async function saveTemplate(id: string, payload: TemplatePayload) {
  const { data, error } = await getSupabase().rpc('save_template', { p_id: id, ...payload });
  if (error) throw error;
  return data;
}

/** Deletes the template unless it was edited after `deletedAt` (last write wins). */
export async function deleteTemplateAt(id: string, deletedAt: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_template', {
    p_id: id,
    p_deleted_at: deletedAt,
  });
  if (error) throw error;
}

export async function templateFromWorkout(workoutId: string, name: string) {
  const { data, error } = await getSupabase().rpc('template_from_workout', {
    p_workout_id: workoutId,
    p_name: name,
  });
  if (error) throw error;
  return data;
}

/** Admin only; checked and logged on the server. */
export async function adminSaveTemplate(id: string | null, payload: TemplatePayload) {
  const { data, error } = await getSupabase().rpc('admin_save_template', { p_id: id, ...payload });
  if (error) throw error;
  return data;
}

export async function adminSetTemplateHidden(id: string, hidden: boolean) {
  const { data, error } = await getSupabase().rpc('admin_set_template_hidden', {
    p_id: id,
    p_hidden: hidden,
  });
  if (error) throw error;
  return data;
}

export async function adminDeleteTemplate(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('admin_delete_template', { p_id: id });
  if (error) throw error;
}
