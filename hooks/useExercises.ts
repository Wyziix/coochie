import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  adminSaveExercise,
  adminSetExerciseHidden,
  fetchExercises,
  fetchLastSets,
  fetchRecentExerciseIds,
  fetchRestSettings,
  type Exercise,
  type ExerciseInput,
  type LastSet,
} from '@/lib/api/exercises';
import { newId } from '@/lib/id';
import { enqueue, useOutboxStore } from '@/lib/offline/outbox';
import { overlayExercises, overlayRest } from '@/lib/offline/overlay';
import { syncNow } from '@/lib/offline/sync';

export const exercisesKey = ['exercises'] as const;

/** Exercise library, incl. custom exercises created offline and not synced yet. */
export function useExercises() {
  const query = useQuery({
    queryKey: exercisesKey,
    queryFn: fetchExercises,
    staleTime: 10 * 60_000,
  });
  const items = useOutboxStore((s) => s.items);
  const data = useMemo(
    () => (query.data ? overlayExercises(query.data, items) : query.data),
    [query.data, items],
  );
  return { ...query, data };
}

export function useExercise(id: string | undefined) {
  const query = useExercises();
  return { ...query, data: query.data?.find((e) => e.id === id) };
}

export function useRestSettings() {
  const query = useQuery({
    queryKey: ['rest-settings'],
    queryFn: fetchRestSettings,
    staleTime: 10 * 60_000,
  });
  const items = useOutboxStore((s) => s.items);
  const data = useMemo(() => overlayRest(query.data, items), [query.data, items]);
  return { ...query, data };
}

/** Queued, so it works offline. */
export function useSaveRestSetting() {
  return useMutation({
    mutationFn: async ({ exerciseId, seconds }: { exerciseId: string; seconds: number }) => {
      await enqueue({
        kind: 'save_rest',
        entityId: exerciseId,
        payload: { seconds },
        label: 'Rest time',
      });
      syncNow();
    },
  });
}

/**
 * Sets from the last workout for each exercise, keyed by exercise id. Cached
 * per exercise, so any mix of exercises has its "previous" values offline.
 */
export function useLastSets(exerciseIds: string[]) {
  const ids = [...new Set(exerciseIds)];
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['last-sets', id],
      queryFn: () => fetchLastSets([id]),
      staleTime: 5 * 60_000,
    })),
    combine: (results) => {
      const data: Record<string, LastSet[]> = {};
      results.forEach((r, i) => {
        if (r.data) data[ids[i]!] = r.data;
      });
      return { data };
    },
  });
}

const upsertInCache = (list: Exercise[] | undefined, e: Exercise) =>
  list?.some((x) => x.id === e.id)
    ? list.map((x) => (x.id === e.id ? e : x))
    : [...(list ?? []), e].sort((a, b) => a.name.localeCompare(b.name));

/** Create or edit a custom exercise. Queued, so it works offline; usable right away. */
export function useSaveCustomExercise() {
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ExerciseInput }) => {
      const exerciseId = id ?? newId();
      await enqueue({
        kind: 'save_exercise',
        entityId: exerciseId,
        payload: input,
        label: `Exercise “${input.name}”`,
      });
      syncNow();
      return { id: exerciseId };
    },
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

export function useRecentExerciseIds() {
  return useQuery({
    queryKey: ['recent-exercises'],
    queryFn: () => fetchRecentExerciseIds(),
    staleTime: 5 * 60_000,
  });
}
