import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Period } from '@/lib/api/points';
import {
  blockUser,
  createFriendChallenge,
  fetchAdminBadges,
  fetchAdminChallenges,
  fetchChallenge,
  fetchChallenges,
  fetchFeed,
  fetchFriends,
  fetchFriendsLeaderboard,
  fetchMyBadges,
  fetchMyStreak,
  fetchNotificationSettings,
  fetchNotifications,
  fetchPrivacySettings,
  fetchReports,
  fetchUnreadCount,
  fetchUserProfile,
  inviteToChallenge,
  markNotificationsRead,
  react,
  removeFriend,
  reportUser,
  resolveReport,
  respondFriendRequest,
  saveBadge,
  saveChallenge,
  saveNotificationSettings,
  savePrivacySettings,
  searchUsers,
  sendFriendRequest,
  setBadgeHidden,
  setChallengeHidden,
  setChallengeStatus,
  setUserBanned,
  unblockUser,
  type AdminBadge,
  type ChallengeInput,
  type NotificationSettings,
  type PrivacySettings,
  type ReportReason,
} from '@/lib/api/social';
import { useIsOnline } from '@/lib/offline/network';
import { useUserId } from '@/stores/authStore';

/** Kept offline (shown with an "Offline" note). */
export function useFeed() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['social', 'feed', userId],
    queryFn: () => fetchFeed(),
    enabled: !!userId,
  });
}

export function useFriends() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['social', 'friends', userId],
    queryFn: fetchFriends,
    enabled: !!userId,
  });
}

export function useUserSearch(query: string) {
  const online = useIsOnline();
  const q = query.trim().toLowerCase();
  return useQuery({
    queryKey: ['social', 'search', q],
    queryFn: () => searchUsers(q),
    enabled: q.length >= 2 && online,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useUserProfile(username: string | undefined) {
  return useQuery({
    queryKey: ['social', 'user', username],
    queryFn: () => fetchUserProfile(username!),
    enabled: !!username,
  });
}

export function useMyStreak() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['social', 'streak', userId],
    queryFn: fetchMyStreak,
    enabled: !!userId,
  });
}

export function useMyBadges() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['social', 'badges', userId],
    queryFn: fetchMyBadges,
    enabled: !!userId,
  });
}

export function useFriendsLeaderboard(period: Period, enabled = true) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['social', 'friends-board', period, userId],
    queryFn: () => fetchFriendsLeaderboard(period),
    enabled: !!userId && enabled,
    staleTime: 30_000,
  });
}

export function useChallenges() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['social', 'challenges', userId],
    queryFn: fetchChallenges,
    enabled: !!userId,
  });
}

export function useChallenge(id: string | undefined) {
  return useQuery({
    queryKey: ['social', 'challenge', id],
    queryFn: () => fetchChallenge(id!),
    enabled: !!id,
  });
}

/** Friend actions: send, accept, decline, cancel, remove, block, unblock. */
export function useFriendAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, userId }: { action: FriendAction; userId: string }) => {
      switch (action) {
        case 'add':
          return sendFriendRequest(userId);
        case 'accept':
          return respondFriendRequest(userId, true);
        case 'decline':
          return respondFriendRequest(userId, false);
        case 'remove':
          return removeFriend(userId);
        case 'block':
          return blockUser(userId);
        case 'unblock':
          return unblockUser(userId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
export type FriendAction = 'add' | 'accept' | 'decline' | 'remove' | 'block' | 'unblock';

export function useReact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string | null }) => react(id, emoji),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social', 'feed'] }),
  });
}

export function useReportUser() {
  return useMutation({
    mutationFn: (r: { userId: string; reason: ReportReason; note?: string; activityId?: string }) =>
      reportUser(r.userId, r.reason, r.note, r.activityId),
  });
}

export function useCreateFriendChallenge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, invite }: { input: ChallengeInput; invite: string[] }) =>
      createFriendChallenge(input, invite),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social', 'challenges'] }),
  });
}

export function useChallengeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'joined' | 'declined' }) =>
      setChallengeStatus(id, status),
    onSuccess: (c) => {
      queryClient.setQueryData(['social', 'challenge', c.id], c);
      queryClient.invalidateQueries({ queryKey: ['social', 'challenges'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useInviteToChallenge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => inviteToChallenge(id, userId),
    onSuccess: (_r, v) =>
      queryClient.invalidateQueries({ queryKey: ['social', 'challenge', v.id] }),
  });
}

// --- Notifications ---------------------------------------------------------------

export function useNotifications() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['notifications', 'list', userId],
    queryFn: fetchNotifications,
    enabled: !!userId,
  });
}

/** For the badge on the Social tab: checked every minute while online. */
export function useUnreadCount() {
  const userId = useUserId();
  const online = useIsOnline();
  return useQuery({
    queryKey: ['notifications', 'unread', userId],
    queryFn: fetchUnreadCount,
    enabled: !!userId,
    refetchInterval: online ? 60_000 : false,
    staleTime: 30_000,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: number[]) => markNotificationsRead(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// --- Settings ----------------------------------------------------------------------

export function usePrivacySettings() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['settings', 'privacy', userId],
    queryFn: fetchPrivacySettings,
    enabled: !!userId,
  });
}

export function useSavePrivacy() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: PrivacySettings) => savePrivacySettings(userId!, values),
    onSuccess: (values) => queryClient.setQueryData(['settings', 'privacy', userId], values),
  });
}

export function useNotificationSettings() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['settings', 'notifications', userId],
    queryFn: fetchNotificationSettings,
    enabled: !!userId,
  });
}

export function useSaveNotificationSettings() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: NotificationSettings) => saveNotificationSettings(userId!, values),
    onSuccess: (values) => queryClient.setQueryData(['settings', 'notifications', userId], values),
  });
}

// --- Admin ---------------------------------------------------------------------------

export function useAdminBadges() {
  return useQuery({ queryKey: ['admin', 'social', 'badges'], queryFn: fetchAdminBadges });
}

export function useSaveBadge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, badge }: { id: string | null; badge: Partial<AdminBadge> }) =>
      saveBadge(id, badge),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'social', 'badges'] });
      queryClient.invalidateQueries({ queryKey: ['social', 'badges'] });
    },
  });
}

export function useSetBadgeHidden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => setBadgeHidden(id, hidden),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'social', 'badges'] }),
  });
}

export function useAdminChallenges() {
  return useQuery({ queryKey: ['admin', 'social', 'challenges'], queryFn: fetchAdminChallenges });
}

export function useSaveChallenge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ChallengeInput }) =>
      saveChallenge(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'social', 'challenges'] });
      queryClient.invalidateQueries({ queryKey: ['social', 'challenges'] });
    },
  });
}

export function useSetChallengeHidden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => setChallengeHidden(id, hidden),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'social', 'challenges'] }),
  });
}

export function useReports(status: 'open' | 'dismissed' | 'actioned' | 'all') {
  return useQuery({
    queryKey: ['admin', 'social', 'reports', status],
    queryFn: () => fetchReports(status),
  });
}

export function useResolveReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: string;
      action: 'dismiss' | 'hide_from_leaderboards' | 'ban';
      note?: string;
    }) => resolveReport(id, action, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export function useSetUserBanned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, banned }: { userId: string; banned: boolean }) =>
      setUserBanned(userId, banned),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}
