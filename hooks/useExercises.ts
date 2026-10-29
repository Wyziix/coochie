import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminSaveExercise,
  adminSetExerciseHidden,
  createCustomExercise,
  fetchExercises,
  fetchLastSets,
  fetchRestSettings,
  saveRestSetting,
  updateCustomExercise,
  type Exercise,
  type ExerciseInput,
} from '@/lib/api/exercises';
import { useUserId } from '@/stores/authStore';

export const exercisesKey = ['exercises'] as const;

export function useExercises() {
  return useQuery({ queryKey: exercisesKey, queryFn: fetchExercises, staleTime: 10 * 60_000 });
}

export function useExercise(id: string | undefined) {
  const query = useExercises();
  return { ...query, data: query.data?.find((e) => e.id === id) };
}

export function useRestSettings() {
  return useQuery({
    queryKey: ['rest-settings'],
    queryFn: fetchRestSettings,
    staleTime: 10 * 60_000,
  });
}

export function useSaveRestSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ exerciseId, seconds }: { exerciseId: string; seconds: number }) =>
      saveRestSetting(exerciseId, seconds),
    onMutate: ({ exerciseId, seconds }) =>
      queryClient.setQueryData<Record<string, number>>(['rest-settings'], (old) => ({
        ...old,
        [exerciseId]: seconds,
      })),
  });
}

/** Sets from the last workout for each exercise, keyed by exercise id. */
export function useLastSets(exerciseIds: string[]) {
  const ids = [...new Set(exerciseIds)].sort();
  return useQuery({
    queryKey: ['last-sets', ids],
    queryFn: async () => {
      const rows = await fetchLastSets(ids);
      const byExercise: Record<string, typeof rows> = {};
      for (const r of rows) (byExercise[r.exercise_id] ??= []).push(r);
      return byExercise;
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
}

const upsertInCache = (list: Exercise[] | undefined, e: Exercise) =>
  list?.some((x) => x.id === e.id)
    ? list.map((x) => (x.id === e.id ? e : x))
    : [...(list ?? []), e].sort((a, b) => a.name.localeCompare(b.name));

export function useSaveCustomExercise() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ExerciseInput }) => {
      if (!userId) throw new Error('Not signed in');
      return id ? updateCustomExercise(id, input) : createCustomExercise(userId, input);
    },
    onSuccess: (e) =>
      queryClient.setQueryData<Exercise[]>(exercisesKey, (l) => upsertInCache(l, e)),
  });
}

export function useAdminSaveExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ExerciseInput }) =>
      adminSaveExercise(id, input),
    onSuccess: (e) =>
      queryClient.setQueryData<Exercise[]>(exercisesKey, (l) => upsertInCache(l, e)),
  });
}

export function useAdminSetExerciseHidden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      adminSetExerciseHidden(id, hidden),
    onSuccess: (e) =>
      queryClient.setQueryData<Exercise[]>(exercisesKey, (l) => upsertInCache(l, e)),
  });
}
