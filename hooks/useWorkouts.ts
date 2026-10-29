import { onlineManager, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  fetchRecentWorkouts,
  fetchWorkout,
  fetchWorkoutsBetween,
  fetchWorkoutsPage,
  type SavePayload,
} from '@/lib/api/workouts';
import { monthRange } from '@/lib/history/calendar';
import { enqueue, hasPendingChange, useOutboxStore } from '@/lib/offline/outbox';
import { overlayWorkouts, workoutChanges, workoutDetailFromChange } from '@/lib/offline/overlay';
import { syncNow } from '@/lib/offline/sync';
import { shortDate } from '@/lib/progress/series';

import { useExercises } from './useExercises';

// Workouts are saved through the sync queue: on the device first, then sent
// through save_workout / delete_workout when there's a connection. Lists and
// details show queued changes on top of the server's (or cached) data.

export function useRecentWorkouts(limit = 5) {
  const query = useQuery({
    queryKey: ['workouts', 'recent', limit],
    queryFn: () => fetchRecentWorkouts(limit),
  });
  const items = useOutboxStore((s) => s.items);
  const data = useMemo(
    () =>
      query.data || items.length ? overlayWorkouts(query.data, items).slice(0, limit) : undefined,
    [query.data, items, limit],
  );
  return { ...query, data };
}

export function useWorkout(id: string | undefined) {
  const query = useQuery({
    queryKey: ['workouts', 'detail', id],
    queryFn: () => fetchWorkout(id!),
    enabled: !!id,
  });
  const items = useOutboxStore((s) => s.items);
  const exercises = useExercises().data;
  const local = useMemo(() => {
    const change = id ? workoutChanges(items).get(id) : undefined;
    if (!change) return undefined;
    if (change.deleted) return null;
    const byId = new Map((exercises ?? []).map((e) => [e.id, e]));
    return workoutDetailFromChange(change.payload, change.item, byId);
  }, [id, items, exercises]);
  if (local === undefined) return query;
  // A queued version is newer than anything the server has.
  return { ...query, data: local, isPending: false, error: null } as typeof query;
}

function label(payload: SavePayload) {
  const w = payload.p_workout;
  return `Workout “${w.name}” (${shortDate(w.started_at)})`;
}

/**
 * Stores the workout on the device and sends it if online. Resolves with
 * `synced` (on the server now) or not (sent later, automatically).
 */
export function useSaveWorkout() {
  return useMutation({
    mutationFn: async (payload: SavePayload) => {
      const id = payload.p_workout.id;
      await enqueue({ kind: 'save_workout', entityId: id, payload, label: label(payload) });
      if (onlineManager.isOnline()) await syncNow();
      return { id, synced: !hasPendingChange(id) };
    },
  });
}

export function useDeleteWorkout() {
  return useMutation({
    mutationFn: async (workout: { id: string; name: string; started_at: string }) => {
      await enqueue({
        kind: 'delete_workout',
        entityId: workout.id,
        payload: null,
        label: `Delete workout “${workout.name}” (${shortDate(workout.started_at)})`,
      });
      if (onlineManager.isOnline()) await syncNow();
    },
  });
}

const PAGE_SIZE = 20;

export function useWorkoutHistory() {
  const query = useInfiniteQuery({
    queryKey: ['workouts', 'history'],
    queryFn: ({ pageParam }) => fetchWorkoutsPage(pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE_SIZE ? pages.length : undefined),
  });
  const items = useOutboxStore((s) => s.items);
  const data = useMemo(() => {
    if (!query.data) {
      // Nothing cached yet (offline), but workouts logged here still show.
      const local = overlayWorkouts([], items);
      return local.length ? { pages: [local], pageParams: [0] } : undefined;
    }
    return {
      ...query.data,
      pages: query.data.pages.map((page, i) =>
        overlayWorkouts(page, items, { insertNew: i === 0 }),
      ),
    };
  }, [query.data, items]);
  return { ...query, data, isPending: query.isPending && !data } as typeof query;
}

export function useMonthWorkouts(year: number, month: number) {
  const query = useQuery({
    queryKey: ['workouts', 'month', year, month],
    queryFn: () => {
      const { from, to } = monthRange(year, month);
      return fetchWorkoutsBetween(from, to);
    },
  });
  const items = useOutboxStore((s) => s.items);
  const data = useMemo(() => {
    const { from, to } = monthRange(year, month);
    const include = (w: { started_at: string }) => {
      const t = Date.parse(w.started_at);
      return t >= from.getTime() && t < to.getTime();
    };
    if (!query.data && !items.length) return undefined;
    return overlayWorkouts(query.data, items, { include });
  }, [query.data, items, year, month]);
  return { ...query, data, isPending: query.isPending && !data } as typeof query;
}
