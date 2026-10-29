import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchRecentWorkouts, fetchWorkout, saveWorkout } from '@/lib/api/workouts';

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      queryClient.invalidateQueries({ queryKey: ['last-sets'] });
    },
  });
}
