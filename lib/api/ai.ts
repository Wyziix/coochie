import { FunctionsHttpError } from '@supabase/supabase-js';

import { AiError } from '@/lib/ai/errors';
import { streamCoachReply, type CoachMessage } from '@/lib/ai/stream';
import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

export { AiError };
export type { CoachMessage };

export type WorkoutFeedbackContent = {
  summary: string;
  positives: string[];
  warnings: string[];
  suggestions: string[];
  see_professional: boolean;
};

export type WeeklyReportContent = {
  summary: string;
  consistency: string;
  volume_trend: string;
  highlights: string[];
  focus_next_week: string[];
  warnings: string[];
  see_professional: boolean;
};

export type Feedback<C> = {
  id: string;
  content: C;
  created_at: string;
  source_updated_at?: string | null;
};

export type WeeklyReport = Feedback<WeeklyReportContent> & {
  week_start: string;
  seen_at: string | null;
};

export type AiFeature = 'workout_feedback' | 'plan' | 'coach';
export type FeatureStatus = { limit: number; used: number; remaining: number };

export type AiStatus = {
  enabled: boolean;
  paused_for_budget: boolean;
  /** Workout feedback (the Stage 6 fields). */
  limit: number;
  used_today: number;
  remaining: number;
  /** Each feature has its own daily limit. */
  features?: Record<AiFeature, FeatureStatus>;
};

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(fn, { body });
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    const parsed = await res
      .json()
      .then((b: { error?: string; message?: string }) => b)
      .catch(() => null);
    if (res.status === 404 && !parsed?.error) {
      throw Object.assign(new Error(`The ${fn} Edge Function isn’t deployed yet.`), {
        code: 'EDGE_FUNCTION_MISSING',
      });
    }
    throw new AiError(parsed?.error ?? `http_${res.status}`, parsed?.message ?? error.message);
  }
  if (error) throw error;
  return data as T;
}

export async function fetchAiStatus(): Promise<AiStatus> {
  const { data, error } = await getSupabase().rpc('ai_status');
  if (error) throw error;
  return data as unknown as AiStatus;
}

/** Saved feedback for a workout (no AI call). */
export async function fetchWorkoutFeedback(
  workoutId: string,
): Promise<Feedback<WorkoutFeedbackContent> | null> {
  const { data, error } = await getSupabase()
    .from('ai_feedback')
    .select('id, content, created_at, source_updated_at')
    .eq('kind', 'workout')
    .eq('workout_id', workoutId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Feedback<WorkoutFeedbackContent> | null;
}

/** Asks for feedback (the server checks the limit first). */
export async function requestWorkoutFeedback(
  workoutId: string,
  regenerate = false,
): Promise<{ feedback: Feedback<WorkoutFeedbackContent>; cached: boolean; stale: boolean }> {
  return invoke('workout-feedback', { workout_id: workoutId, regenerate });
}

export async function fetchWeeklyReports(): Promise<WeeklyReport[]> {
  const { data, error } = await getSupabase()
    .from('ai_feedback')
    .select('id, content, created_at, week_start, seen_at')
    .eq('kind', 'weekly')
    .order('week_start', { ascending: false })
    .limit(26);
  if (error) throw error;
  return data as unknown as WeeklyReport[];
}

export async function markReportSeen(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('ai_mark_seen', { p_id: id });
  if (error) throw error;
}

export async function savePushToken(token: string, platform: string): Promise<void> {
  const { error } = await getSupabase().rpc('save_push_token', {
    p_token: token,
    p_platform: platform,
  });
  if (error) throw error;
}

export async function deletePushToken(token: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_push_token', { p_token: token });
  if (error) throw error;
}

// --- Admin (checked and logged on the server) ---------------------------------

export type AiSettings = {
  enabled: boolean;
  /** Same as limit_workout_feedback (Stage 6 name). */
  daily_limit: number;
  limit_workout_feedback: number;
  limit_plan: number;
  limit_coach: number;
  max_tokens_plan: number;
  max_tokens_coach: number;
  daily_budget_usd: number;
  model: string;
  max_tokens_feedback: number;
  max_tokens_weekly: number;
  price_input: number;
  price_output: number;
  price_cache_write: number;
  price_cache_read: number;
  timezone: string;
  updated_at: string;
  spent_today_usd: number;
};

export type AiOverride = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  function: AiFeature;
  daily_limit: number;
};

export type AiUsageReport = {
  since: string;
  days: { day: string; calls: number; errors: number; blocked: number; cost_usd: number }[];
  top_users: { user_id: string; username: string | null; calls: number; cost_usd: number }[];
  totals: {
    calls: number;
    errors: number;
    blocked: number;
    error_rate: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  };
};

export async function fetchAiSettings(): Promise<AiSettings> {
  const { data, error } = await getSupabase().rpc('admin_ai_settings');
  if (error) throw error;
  return data as unknown as AiSettings;
}

export async function updateAiSettings(changes: Partial<AiSettings>): Promise<AiSettings> {
  const { data, error } = await getSupabase().rpc('admin_update_ai_settings', {
    p_changes: changes,
  });
  if (error) throw error;
  return data as unknown as AiSettings;
}

export async function fetchAiOverrides(): Promise<AiOverride[]> {
  const { data, error } = await getSupabase().rpc('admin_ai_feature_overrides');
  if (error) throw error;
  return data as unknown as AiOverride[];
}

export async function setAiOverride(
  userId: string,
  limit: number | null,
  feature: AiFeature = 'workout_feedback',
): Promise<void> {
  const { error } = await getSupabase().rpc('admin_set_ai_override', {
    p_user: userId,
    p_limit: limit,
    p_function: feature,
  });
  if (error) throw error;
}

export async function findUsers(
  query: string,
): Promise<
  { user_id: string; username: string | null; display_name: string | null; email: string }[]
> {
  const { data, error } = await getSupabase().rpc('admin_find_users', { p_query: query });
  if (error) throw error;
  return data as unknown as {
    user_id: string;
    username: string | null;
    display_name: string | null;
    email: string;
  }[];
}

export async function fetchAiUsage(days = 30): Promise<AiUsageReport> {
  const { data, error } = await getSupabase().rpc('admin_ai_usage', { p_days: days });
  if (error) throw error;
  return data as unknown as AiUsageReport;
}

// --- Plans ---------------------------------------------------------------------

export type PlanEquipment = 'full_gym' | 'home_dumbbells' | 'bodyweight';

export type PlanRequest = {
  goal: 'strength' | 'hypertrophy' | 'fat_loss' | 'general_fitness';
  experience: 'beginner' | 'intermediate' | 'advanced';
  days_per_week: number;
  session_minutes: number;
  equipment: PlanEquipment;
};

export type GeneratedPlan = {
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

export type Program = {
  id: string;
  name: string;
  description: string | null;
  weeks: number | null;
  notes: string[];
  created_at: string;
};

/** Asks Claude for a plan (counts toward the daily plan limit). Nothing is saved. */
export async function generatePlan(request: PlanRequest): Promise<{ plan: GeneratedPlan }> {
  return invoke('generate-plan', request);
}

/** Saves the accepted plan as a program: one template per day. */
export async function savePlan(
  program: { name: string; description: string; weeks: number; notes: string[] },
  days: { p_template: Json; p_exercises: Json }[],
): Promise<string> {
  const { data, error } = await getSupabase().rpc('save_ai_plan', {
    p_program: program,
    p_days: days as unknown as Json,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchPrograms(): Promise<Program[]> {
  const { data, error } = await getSupabase()
    .from('user_programs')
    .select('id, name, description, weeks, notes, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as Program[];
}

/** Deletes the program and all its templates (past workouts stay). */
export async function deleteProgram(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_program', { p_id: id });
  if (error) throw error;
}

// --- Coach ---------------------------------------------------------------------

export async function fetchCoachMessages(): Promise<CoachMessage[]> {
  const { data, error } = await getSupabase()
    .from('coach_messages')
    .select('id, role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as unknown as CoachMessage[]).reverse();
}

/** Streams the reply (text so far → onText); resolves with both saved messages. */
export function sendCoachMessage(
  message: string,
  onText: (textSoFar: string) => void,
): Promise<CoachMessage[]> {
  return streamCoachReply(message, onText);
}

/** Deletes the whole chat (only the user's own messages, by RLS). */
export async function clearCoachChat(userId: string): Promise<void> {
  const { error } = await getSupabase().from('coach_messages').delete().eq('user_id', userId);
  if (error) throw error;
}

/** Admin test: the admin's own report for the current week, right now. */
export async function generateWeeklyReportNow(): Promise<{ report: WeeklyReport }> {
  return invoke('weekly-report', { mode: 'admin_test' });
}
