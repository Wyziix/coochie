import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchAdminUsers,
  fetchFlaggedWorkouts,
  fetchLeaderboard,
  fetchMyLedger,
  fetchMyPoints,
  fetchPointsRules,
  fetchPointsSettings,
  fetchUserLedger,
  fetchWorkoutPoints,
  reviewWorkout,
  setUserModeration,
  updatePointsSettings,
  type Period,
  type PointsSettings,
} from '@/lib/api/points';
import { useUserId } from '@/stores/authStore';

/** My total, this week, this month, level. Kept offline. */
export function useMyPoints() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['points', 'me', userId],
    queryFn: fetchMyPoints,
    enabled: !!userId,
  });
}

/** A leaderboard. Kept offline, so the last copy shows without a connection. */
export function useLeaderboard(period: Period) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['points', 'board', period, userId],
    queryFn: () => fetchLeaderboard(period),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/** Points for one workout; null while it's not on the server yet. */
export function useWorkoutPoints(workoutId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['points', 'workout', workoutId],
    queryFn: () => fetchWorkoutPoints(workoutId!),
    enabled: !!workoutId && enabled,
    staleTime: 0,
  });
}

export function usePointsRules() {
  return useQuery({
    queryKey: ['points', 'rules'],
    queryFn: fetchPointsRules,
    staleTime: 60 * 60_000,
  });
}

export function useMyLedger() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['points', 'ledger', userId],
    queryFn: fetchMyLedger,
    enabled: !!userId,
  });
}

// --- Admin ---------------------------------------------------------------------

export function usePointsSettings() {
  return useQuery({ queryKey: ['admin', 'points', 'settings'], queryFn: fetchPointsSettings });
}

export function useUpdatePointsSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<PointsSettings>) => updatePointsSettings(changes),
    onSuccess: (settings) => {
      queryClient.setQueryData(['admin', 'points', 'settings'], settings);
      queryClient.invalidateQueries({ queryKey: ['points'] });
    },
  });
}

export function useFlaggedWorkouts(status: 'pending' | 'approved' | 'rejected' | 'all') {
  return useQuery({
    queryKey: ['admin', 'points', 'flagged', status],
    queryFn: () => fetchFlaggedWorkouts(status),
  });
}

export function useReviewWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workoutId, approve }: { workoutId: string; approve: boolean }) =>
      reviewWorkout(workoutId, approve),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'points'] });
      queryClient.invalidateQueries({ queryKey: ['points'] });
    },
  });
}

export function useAdminUsers(query: string) {
  return useQuery({
    queryKey: ['admin', 'points', 'users', query],
    queryFn: () => fetchAdminUsers(query),
  });
}

export function useSetUserModeration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      ...moderation
    }: {
      userId: string;
      leaderboard_banned: boolean;
      hidden: boolean;
      note?: string | null;
    }) => setUserModeration(userId, moderation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'points', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['points', 'board'] });
    },
  });
}

export function useUserLedger(userId: string | null) {
  return useQuery({
    queryKey: ['admin', 'points', 'ledger', userId],
    queryFn: () => fetchUserLedger(userId!),
    enabled: !!userId,
  });
}
