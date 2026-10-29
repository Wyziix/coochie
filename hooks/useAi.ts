import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchAiOverrides,
  fetchAiSettings,
  fetchAiStatus,
  fetchAiUsage,
  fetchWeeklyReports,
  fetchWorkoutFeedback,
  generateWeeklyReportNow,
  markReportSeen,
  requestWorkoutFeedback,
  setAiOverride,
  updateAiSettings,
  type AiSettings,
} from '@/lib/api/ai';
import { useUserId } from '@/stores/authStore';

/** AI on/off and calls left today (no AI call). */
export function useAiStatus() {
  const userId = useUserId();
  // Never from the cached copy: calls left must be right now's number.
  return useQuery({
    queryKey: ['ai-status', userId],
    queryFn: fetchAiStatus,
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Saved feedback for a workout, if any. Kept offline too, so it reopens for free. */
export function useWorkoutFeedback(workoutId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['ai', 'feedback', workoutId],
    queryFn: () => fetchWorkoutFeedback(workoutId!),
    enabled: !!workoutId && enabled,
    // Saved feedback doesn't change; "none yet" is checked again each time.
    staleTime: (query) => (query.state.data ? Infinity : 0),
  });
}

export function useRequestFeedback(workoutId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (regenerate: boolean = false) => requestWorkoutFeedback(workoutId, regenerate),
    onSuccess: (result) => {
      queryClient.setQueryData(['ai', 'feedback', workoutId], result.feedback);
      queryClient.invalidateQueries({ queryKey: ['ai-status'] });
    },
    // A refusal (limit, paused) also changes what's left today.
    onError: () => queryClient.invalidateQueries({ queryKey: ['ai-status'] }),
  });
}

export function useWeeklyReports() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['ai', 'weekly', userId],
    queryFn: fetchWeeklyReports,
    enabled: !!userId,
  });
}

/** Reports not opened yet: the in-app "New weekly report" badge. */
export function useUnseenReports() {
  const reports = useWeeklyReports();
  return (reports.data ?? []).filter((r) => !r.seen_at);
}

export function useMarkReportSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markReportSeen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai', 'weekly'] }),
  });
}

// --- Admin ---------------------------------------------------------------------

export function useAiSettings() {
  return useQuery({ queryKey: ['admin', 'ai', 'settings'], queryFn: fetchAiSettings });
}

export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<AiSettings>) => updateAiSettings(changes),
    onSuccess: (settings) => {
      queryClient.setQueryData(['admin', 'ai', 'settings'], settings);
      queryClient.invalidateQueries({ queryKey: ['ai-status'] });
    },
  });
}

export function useAiOverrides() {
  return useQuery({ queryKey: ['admin', 'ai', 'overrides'], queryFn: fetchAiOverrides });
}

export function useSetAiOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, limit }: { userId: string; limit: number | null }) =>
      setAiOverride(userId, limit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'overrides'] });
      queryClient.invalidateQueries({ queryKey: ['ai-status'] });
    },
  });
}

export function useAiUsage(days = 30) {
  return useQuery({ queryKey: ['admin', 'ai', 'usage', days], queryFn: () => fetchAiUsage(days) });
}

export function useGenerateReportNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateWeeklyReportNow,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'weekly'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'usage'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'settings'] });
    },
  });
}
