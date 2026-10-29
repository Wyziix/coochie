import { useQuery } from '@tanstack/react-query';

import {
  fetchExerciseHistory,
  fetchExerciseRecords,
  fetchRecentRecords,
  fetchTrainedExercises,
  fetchWeeklyOverview,
  fetchWorkoutRecords,
} from '@/lib/api/progress';
import { rangeStart, type Range } from '@/lib/progress/series';
import { weekBounds } from '@/lib/progress/week';

// Everything here is derived from workouts, so it lives under ['workouts', ...]
// and refreshes whenever a workout is saved, edited or deleted.
export function useWorkoutRecords(workoutId: string | undefined) {
  return useQuery({
    queryKey: ['workouts', 'records', workoutId],
    queryFn: () => fetchWorkoutRecords(workoutId!),
    enabled: !!workoutId,
  });
}

export function useExerciseRecords(exerciseId: string | undefined) {
  return useQuery({
    queryKey: ['workouts', 'exercise-records', exerciseId],
    queryFn: () => fetchExerciseRecords(exerciseId!),
    enabled: !!exerciseId,
  });
}

export function useExerciseHistory(exerciseId: string | undefined, range: Range) {
  return useQuery({
    queryKey: ['workouts', 'exercise-history', exerciseId, range],
    queryFn: () => fetchExerciseHistory(exerciseId!, rangeStart(range)),
    enabled: !!exerciseId,
  });
}

export function useTrainedExercises() {
  return useQuery({ queryKey: ['workouts', 'trained-exercises'], queryFn: fetchTrainedExercises });
}

export function useRecentRecords(limit = 10) {
  return useQuery({
    queryKey: ['workouts', 'recent-records', limit],
    queryFn: () => fetchRecentRecords(limit),
  });
}

export function useWeeklyOverview(now = new Date()) {
  const { from, to } = weekBounds(now);
  return useQuery({
    queryKey: ['workouts', 'week', from.toISOString()],
    queryFn: () => fetchWeeklyOverview(from, to),
  });
}
