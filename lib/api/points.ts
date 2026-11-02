import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

export type Level = {
  level: number;
  name: string;
  min_points: number;
  next_points: number | null;
  points: number;
};

export type MyPoints = {
  total: number;
  week: number;
  month: number;
  level: Level;
  under_review: number;
};

export type Period = 'week' | 'month' | 'all';

export type LeaderboardEntry = {
  rank: number;
  username: string;
  avatar_url: string | null;
  level: number;
  points: number;
  is_me: boolean;
};

export type Leaderboard = {
  period: Period;
  week_start: string | null;
  month_start: string | null;
  refreshed_at: string | null;
  entries: LeaderboardEntry[];
  me: {
    rank: number | null;
    points: number;
    level: number;
    username: string | null;
    avatar_url: string | null;
    hidden: boolean;
    removed: boolean;
  } | null;
};

export type PointsReason = 'workout' | 'sets' | 'pr' | 'daily_cap' | 'weekly_goal' | 'streak';

export type PointsItem = { reason: PointsReason; points: number; details: Record<string, Json> };

export type WorkoutPoints = {
  review: 'pending' | 'rejected' | null;
  points: number;
  items: PointsItem[];
  level_before: Level;
  level_after: Level;
};

export type LedgerRow = {
  id: number;
  points: number;
  reason: PointsReason;
  source_type: 'workout' | 'week';
  source_id: string;
  workout_id: string | null;
  earned_at: string;
  day: string;
  details: Record<string, Json>;
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export type PointsRules = {
  workout_points: number;
  min_working_sets: number;
  set_points: number;
  set_points_cap: number;
  pr_points: number;
  pr_cap: number;
  daily_cap: number;
  weekly_goal_points: number;
  goal_min_days: number;
  goal_max_days: number;
  streak_points: number;
  streak_cap_weeks: number;
  timezone: string;
};

export const fetchMyPoints = () => rpc<MyPoints>('my_points');
export const fetchPointsRules = () => rpc<PointsRules>('points_rules');
export const fetchLeaderboard = (period: Period) =>
  rpc<Leaderboard>('leaderboard', { p_period: period, p_limit: 50 });
/** Null when the workout isn't on the server yet (still syncing). */
export const fetchWorkoutPoints = (workoutId: string) =>
  rpc<WorkoutPoints | null>('workout_points', { p_workout: workoutId });

export async function fetchMyLedger(): Promise<LedgerRow[]> {
  const { data, error } = await getSupabase()
    .from('points_ledger')
    .select('id, points, reason, source_type, source_id, workout_id, earned_at, day, details')
    .order('earned_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data as unknown as LedgerRow[];
}

// --- Admin (checked and logged on the server) ---------------------------------

export type PointsSettings = {
  workout_points: number;
  min_working_sets: number;
  set_points: number;
  set_points_cap: number;
  pr_points: number;
  pr_cap: number;
  daily_cap: number;
  weekly_goal_points: number;
  goal_min_days: number;
  goal_max_days: number;
  streak_points: number;
  streak_cap_weeks: number;
  level_base: number;
  level_exponent: number;
  flag_min_minutes: number;
  flag_max_workouts_per_day: number;
  flag_backdate_days: number;
  flag_jump_pct: number;
  flag_jump_min_kg: number;
  flag_max_set_kg: number;
  flag_default_bodyweight_kg: number;
  weight_ratios: Record<string, number>;
  equipment_factors: Record<string, number>;
  timezone: string;
  updated_at: string;
};

export type FlagReason =
  | { reason: 'unrealistic_weight'; exercise: string; weight_kg: number; limit_kg: number }
  | { reason: 'big_jump'; exercise: string; weight_kg: number; previous_kg: number }
  | { reason: 'too_short'; minutes: number }
  | { reason: 'too_many_today'; workout_of_the_day: number }
  | { reason: 'backdated'; days: number };

export type FlaggedWorkout = {
  workout_id: string;
  status: 'pending' | 'approved' | 'rejected';
  reasons: FlagReason[];
  flagged_at: string;
  reviewed_at: string | null;
  user_id: string;
  username: string | null;
  display_name: string | null;
  bodyweight_kg: number | null;
  name: string;
  started_at: string;
  duration_seconds: number;
  logged_at: string;
  sets: {
    exercise: string;
    set_type: string;
    weight_kg: number | null;
    reps: number | null;
    duration_seconds: number | null;
    distance_m: number | null;
  }[];
};

export type AdminUser = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
  points: number;
  level: number;
  self_hidden: boolean;
  leaderboard_banned: boolean;
  hidden: boolean;
  note: string | null;
  pending_flags: number;
};

export type AdminLedgerRow = Omit<LedgerRow, 'id' | 'workout_id'> & { workout: string | null };

export const fetchPointsSettings = () => rpc<PointsSettings>('admin_points_settings');
export const updatePointsSettings = (changes: Partial<PointsSettings>) =>
  rpc<PointsSettings>('admin_update_points_settings', { p_changes: changes });
export const fetchFlaggedWorkouts = (
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending',
) => rpc<FlaggedWorkout[]>('admin_flagged_workouts', { p_status: status });
export const reviewWorkout = (workoutId: string, approve: boolean) =>
  rpc<null>('admin_review_workout', { p_workout: workoutId, p_approve: approve });
export const fetchAdminUsers = (query = '') => rpc<AdminUser[]>('admin_users', { p_query: query });
export const setUserModeration = (
  userId: string,
  moderation: { leaderboard_banned: boolean; hidden: boolean; note?: string | null },
) =>
  rpc<null>('admin_set_user_moderation', {
    p_user: userId,
    p_leaderboard_banned: moderation.leaderboard_banned,
    p_hidden: moderation.hidden,
    p_note: moderation.note ?? null,
  });
export const fetchUserLedger = (userId: string) =>
  rpc<AdminLedgerRow[]>('admin_user_ledger', { p_user: userId });
