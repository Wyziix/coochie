import { getSupabase } from '@/lib/supabase';

import type { Period } from './points';

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

// --- People --------------------------------------------------------------------

export type Relation = 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked' | 'me';

export type UserCard = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  level: number;
};

export type SearchResult = UserCard & { relation: Relation };

export type Friends = {
  friends: UserCard[];
  incoming: UserCard[];
  outgoing: UserCard[];
  blocked: { user_id: string; username: string }[];
};

export type Streak = {
  current: number;
  longest: number;
  this_week_done: boolean;
  this_week_sessions?: number;
  goal?: number;
};

export type FeedKind = 'workout' | 'pr' | 'badge' | 'level_up' | 'challenge_win';

export type FeedItem = {
  id: string;
  kind: FeedKind;
  occurred_at: string;
  is_mine: boolean;
  user: UserCard;
  payload: {
    name?: string;
    minutes?: number;
    sets?: number;
    exercises?: number;
    exercise?: string;
    weight_kg?: number;
    badge?: string;
    icon?: string;
    level?: number;
    challenge?: string;
    score?: number;
    metric?: string;
  };
  reactions: Record<string, number>;
  my_reaction: string | null;
};

export type UserProfile = UserCard & {
  relation: Relation;
  streak: Streak;
  badges: { name: string; icon: string; earned_at: string }[];
  activity: FeedItem[] | null;
  activity_hidden: boolean;
};

export const searchUsers = (query: string) =>
  rpc<SearchResult[]>('search_users', { p_query: query });
export const sendFriendRequest = (userId: string) =>
  rpc<Relation>('send_friend_request', { p_user: userId });
export const respondFriendRequest = (userId: string, accept: boolean) =>
  rpc<Relation>('respond_friend_request', { p_user: userId, p_accept: accept });
/** Cancels my request or removes a friend. */
export const removeFriend = (userId: string) => rpc<Relation>('remove_friend', { p_user: userId });
export const blockUser = (userId: string) => rpc<Relation>('block_user', { p_user: userId });
export const unblockUser = (userId: string) => rpc<Relation>('unblock_user', { p_user: userId });
export const fetchFriends = () => rpc<Friends>('my_friends');
export const fetchUserProfile = (username: string) =>
  rpc<UserProfile>('user_profile', { p_username: username });
export const fetchMyStreak = () => rpc<Streak>('my_streak');

// --- Feed ----------------------------------------------------------------------

export const fetchFeed = (before?: string) =>
  rpc<FeedItem[]>('feed', { p_before: before ?? null, p_limit: 30 });
/** null removes my reaction. */
export const react = (activityId: string, emoji: string | null) =>
  rpc<FeedItem>('react', { p_activity: activityId, p_emoji: emoji });

// --- Badges --------------------------------------------------------------------

export type Badge = {
  id: string;
  slug: string | null;
  name: string;
  description: string;
  icon: string;
  category: 'milestone' | 'consistency' | 'strength' | 'fun' | 'challenge';
  earned_at: string | null;
  progress: { current: number; target: number | null; earned_at: string | null } | null;
};

export const fetchMyBadges = () => rpc<Badge[]>('my_badges');

// --- Leaderboard ---------------------------------------------------------------

export type FriendsBoard = {
  period: Period;
  refreshed_at: string | null;
  friends: number;
  entries: {
    rank: number;
    username: string;
    avatar_url: string | null;
    level: number;
    points: number;
    is_me: boolean;
  }[];
};

export const fetchFriendsLeaderboard = (period: Period) =>
  rpc<FriendsBoard>('friends_leaderboard', { p_period: period });

// --- Challenges ----------------------------------------------------------------

export type ChallengeMetric = 'workouts' | 'sets' | 'points' | 'exercise';

export type Challenge = {
  id: string;
  kind: 'global' | 'friend';
  title: string;
  description: string | null;
  metric: ChallengeMetric;
  exercise: string | null;
  exercise_id: string | null;
  goal: number | null;
  start_date: string;
  end_date: string;
  ends_at: string;
  reward_points: number;
  reward_badge: string | null;
  state: 'upcoming' | 'active' | 'finished';
  created_by: string | null;
  is_mine: boolean;
  my_status: 'invited' | 'joined' | 'declined' | null;
  my_score: number | null;
  participants: number;
  is_hidden?: boolean;
  ranking:
    | (UserCard & {
        rank: number | null;
        score: number | null;
        is_me: boolean;
        winner: boolean;
        status: string;
      })[]
    | null;
};

export type ChallengeInput = {
  title: string;
  description?: string | null;
  metric: ChallengeMetric;
  exercise_id?: string | null;
  goal?: number | null;
  start_date: string;
  end_date: string;
  reward_points?: number;
  reward_badge_id?: string | null;
};

export const fetchChallenges = () => rpc<Challenge[]>('challenges_list');
export const fetchChallenge = (id: string) => rpc<Challenge>('challenge_detail', { p_id: id });
export const createFriendChallenge = (input: ChallengeInput, invite: string[]) =>
  rpc<string>('create_friend_challenge', { p_challenge: input, p_invite: invite });
export const inviteToChallenge = (challengeId: string, userId: string) =>
  rpc<null>('invite_to_challenge', { p_challenge: challengeId, p_user: userId });
export const setChallengeStatus = (challengeId: string, status: 'joined' | 'declined') =>
  rpc<Challenge>('set_challenge_status', { p_challenge: challengeId, p_status: status });

// --- Reports -------------------------------------------------------------------

export type ReportReason = 'spam' | 'harassment' | 'cheating' | 'inappropriate' | 'other';

export const reportUser = (
  userId: string,
  reason: ReportReason,
  note?: string,
  activityId?: string,
) =>
  rpc<null>('report_user', {
    p_user: userId,
    p_reason: reason,
    p_note: note ?? null,
    p_activity: activityId ?? null,
  });

// --- Notifications -------------------------------------------------------------

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'pr_beaten'
  | 'challenge_invite'
  | 'challenge_ending'
  | 'streak_risk';

export type AppNotification = {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  data: { url?: string };
  read_at: string | null;
  created_at: string;
};

export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await getSupabase()
    .from('notifications' as never)
    .select('id, type, title, body, data, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return data as unknown as AppNotification[];
}
export const fetchUnreadCount = () => rpc<number>('unread_notifications');
/** No ids: all. */
export const markNotificationsRead = (ids?: number[]) =>
  rpc<null>('mark_notifications_read', { p_ids: ids ?? null });

// --- Settings (own rows, RLS) --------------------------------------------------

export type PrivacySettings = {
  activity_visibility: 'friends' | 'nobody';
  pr_show_weight: boolean;
};
export type NotificationSettings = Record<NotificationType, boolean>;

export const defaultPrivacy: PrivacySettings = {
  activity_visibility: 'friends',
  pr_show_weight: true,
};
export const defaultNotificationSettings: NotificationSettings = {
  friend_request: true,
  friend_accepted: true,
  pr_beaten: true,
  challenge_invite: true,
  challenge_ending: true,
  streak_risk: true,
};

async function ownRow<T>(table: string, columns: string, fallback: T): Promise<T> {
  const { data, error } = await getSupabase()
    .from(table as never)
    .select(columns)
    .maybeSingle();
  if (error) throw error;
  return { ...fallback, ...((data as T | null) ?? {}) };
}

async function saveOwnRow<T extends object>(table: string, userId: string, values: T): Promise<T> {
  const { error } = await getSupabase()
    .from(table as never)
    .upsert({ user_id: userId, ...values, updated_at: new Date().toISOString() } as never);
  if (error) throw error;
  return values;
}

export const fetchPrivacySettings = () =>
  ownRow<PrivacySettings>(
    'privacy_settings',
    'activity_visibility, pr_show_weight',
    defaultPrivacy,
  );
export const savePrivacySettings = (userId: string, values: PrivacySettings) =>
  saveOwnRow('privacy_settings', userId, values);
export const fetchNotificationSettings = () =>
  ownRow<NotificationSettings>(
    'notification_settings',
    'friend_request, friend_accepted, pr_beaten, challenge_invite, challenge_ending, streak_risk',
    defaultNotificationSettings,
  );
export const saveNotificationSettings = (userId: string, values: NotificationSettings) =>
  saveOwnRow('notification_settings', userId, values);

// --- Admin (checked and logged on the server) ---------------------------------

export type AdminBadge = {
  id: string;
  slug: string | null;
  name: string;
  description: string;
  icon: string;
  category: Badge['category'];
  rule_type: string;
  rule: Record<string, unknown>;
  position: number;
  is_hidden: boolean;
  earned_by: number;
};

export type AdminReport = {
  id: string;
  reason: ReportReason;
  note: string | null;
  status: 'open' | 'dismissed' | 'actioned';
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  reporter: string | null;
  reported: UserCard & {
    email: string;
    leaderboard_banned: boolean;
    banned: boolean;
    reports: number;
  };
  activity: { kind: FeedKind; payload: FeedItem['payload']; occurred_at: string } | null;
};

export const fetchAdminBadges = () => rpc<AdminBadge[]>('admin_badges');
export const saveBadge = (id: string | null, badge: Partial<AdminBadge>) =>
  rpc<string>('admin_save_badge', { p_id: id, p_badge: badge });
export const setBadgeHidden = (id: string, hidden: boolean) =>
  rpc<null>('admin_set_badge_hidden', { p_id: id, p_hidden: hidden });
export const fetchAdminChallenges = () => rpc<Challenge[]>('admin_challenges');
export const saveChallenge = (id: string | null, input: ChallengeInput) =>
  rpc<string>('admin_save_challenge', { p_id: id, p_challenge: input });
export const setChallengeHidden = (id: string, hidden: boolean) =>
  rpc<null>('admin_set_challenge_hidden', { p_id: id, p_hidden: hidden });
export const fetchReports = (status: 'open' | 'dismissed' | 'actioned' | 'all' = 'open') =>
  rpc<AdminReport[]>('admin_reports', { p_status: status });
export const resolveReport = (
  id: string,
  action: 'dismiss' | 'hide_from_leaderboards' | 'ban',
  note?: string,
) => rpc<null>('admin_resolve_report', { p_id: id, p_action: action, p_note: note ?? null });
export const setUserBanned = (userId: string, banned: boolean) =>
  rpc<null>('admin_set_user_banned', { p_user: userId, p_banned: banned });
