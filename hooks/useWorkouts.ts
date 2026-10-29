import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deleteWorkout,
  fetchRecentWorkouts,
  fetchWorkout,
  fetchWorkoutsBetween,
  fetchWorkoutsPage,
  saveWorkout,
} from '@/lib/api/workouts';
import { monthRange } from '@/lib/history/calendar';

export function useRecentWorkouts(limit = 5) {
  return useQuery({
    queryKey: ['workouts', 'recent', limit],
    queryFn: () => fetchRecentWorkouts(limit),
  });
}

export function useWorkout(id: string | undefined) {
  return useQuery({
    queryKey: ['workouts', 'detail', id],
    queryFn: () => fetchWorkout(id!),
    enabled: !!id,
  });
}

export function useSaveWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveWorkout,
    onSuccess: () => invalidateWorkoutData(queryClient),
  });
}

/** Everything derived from workouts: lists, details, calendar, last-time sets. */
function invalidateWorkoutData(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['workouts'] });
  queryClient.invalidateQueries({ queryKey: ['last-sets'] });
  queryClient.invalidateQueries({ queryKey: ['recent-exercises'] });
}

export function useDeleteWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteWorkout,
    onSuccess: () => invalidateWorkoutData(queryClient),
  });
}

const PAGE_SIZE = 20;

export function useWorkoutHistory() {
  return useInfiniteQuery({
    queryKey: ['workouts', 'history'],
    queryFn: ({ pageParam }) => fetchWorkoutsPage(pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE_SIZE ? pages.length : undefined),
  });
}

export function useMonthWorkouts(year: number, month: number) {
  return useQuery({
    queryKey: ['workouts', 'month', year, month],
    queryFn: () => {
      const { from, to } = monthRange(year, month);
      return fetchWorkoutsBetween(from, to);
    },
  });
}
