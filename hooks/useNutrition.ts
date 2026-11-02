import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  fetchAdminFoods,
  fetchDay,
  fetchFavorites,
  fetchRange,
  fetchRecentFoods,
  fetchTargets,
  lookupBarcode,
  saveMyFood,
  saveTargets,
  searchFoods,
  setFoodHidden,
  updateFood,
  type Food,
  type FoodInput,
  type FoodLog,
  type Meal,
  type Targets,
  type WaterLog,
} from '@/lib/api/nutrition';
import { newId } from '@/lib/id';
import { addDays, totals, waterTotal } from '@/lib/nutrition/calc';
import { useIsOnline } from '@/lib/offline/network';
import { enqueue, useOutboxStore } from '@/lib/offline/outbox';
import { overlayFavorites, overlayFoodLogs, overlayWater } from '@/lib/offline/overlay';
import { syncNow } from '@/lib/offline/sync';
import { useUserId } from '@/stores/authStore';

/** One day's food and water, including changes made offline. */
export function useNutritionDay(day: string) {
  const userId = useUserId();
  const query = useQuery({
    queryKey: ['nutrition', 'day', day, userId],
    queryFn: () => fetchDay(day),
    enabled: !!userId,
  });
  const items = useOutboxStore((s) => s.items);
  const data = useMemo(() => {
    const logs = overlayFoodLogs(query.data?.logs, items, (d) => d === day);
    const water = overlayWater(query.data?.water, items, (d) => d === day);
    return { logs, water, totals: totals(logs), water_ml: waterTotal(water) };
  }, [query.data, items, day]);
  return { ...query, data: query.data || items.length ? data : undefined };
}

/** The 7 days ending on `end` (per day totals, averages over logged days). */
export function useNutritionWeek(end: string) {
  const userId = useUserId();
  const start = addDays(end, -6);
  const query = useQuery({
    queryKey: ['nutrition', 'week', end, userId],
    queryFn: () => fetchRange(start, end),
    enabled: !!userId,
  });
  const items = useOutboxStore((s) => s.items);
  const data = useMemo(() => {
    const inRange = (d: string) => d >= start && d <= end;
    const logs = overlayFoodLogs(query.data?.logs, items, inRange);
    const water = overlayWater(query.data?.water, items, inRange);
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      const l = logs.filter((x) => x.day === day);
      return {
        day,
        logged: l.length > 0,
        ...totals(l),
        water_ml: waterTotal(water.filter((w) => w.day === day)),
      };
    });
    const logged = days.filter((d) => d.logged);
    const avg = (k: 'kcal' | 'protein' | 'carbs' | 'fat') =>
      logged.length ? Math.round(logged.reduce((a, d) => a + d[k], 0) / logged.length) : 0;
    return {
      days,
      daysLogged: logged.length,
      avg: { kcal: avg('kcal'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat') },
    };
  }, [query.data, items, start, end]);
  return { ...query, data: query.data || items.length ? data : undefined };
}

export function useTargets() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['nutrition', 'targets', userId],
    queryFn: fetchTargets,
    enabled: !!userId,
  });
}

export function useSaveTargets() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (t: Targets) => saveTargets(userId!, t),
    onSuccess: (t) => queryClient.setQueryData(['nutrition', 'targets', userId], t),
  });
}

export function useFavorites() {
  const userId = useUserId();
  const query = useQuery({
    queryKey: ['nutrition', 'favorites', userId],
    queryFn: fetchFavorites,
    enabled: !!userId,
  });
  const items = useOutboxStore((s) => s.items);
  const data = useMemo(() => overlayFavorites(query.data, items), [query.data, items]);
  return { ...query, data };
}

export function useRecentFoods() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['nutrition', 'recent', userId],
    queryFn: fetchRecentFoods,
    enabled: !!userId,
  });
}

/** Online only: Open Food Facts through the food-search Edge Function. */
export function useFoodSearch(query: string) {
  const online = useIsOnline();
  const q = query.trim();
  return useQuery({
    queryKey: ['nutrition', 'search', q.toLowerCase()],
    queryFn: () => searchFoods(q),
    enabled: online && q.length >= 2,
    staleTime: 5 * 60_000,
  });
}

export function useBarcodeLookup() {
  return useMutation({ mutationFn: (code: string) => lookupBarcode(code) });
}

export function useSaveMyFood() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (food: FoodInput) => saveMyFood(food),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nutrition', 'search'] }),
  });
}

// --- Queued changes (work offline) ----------------------------------------------

export function useLogFood() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (log: Omit<FoodLog, 'id'> & { id?: string }) => {
      const id = log.id ?? newId();
      await enqueue({
        kind: 'save_food_log',
        entityId: id,
        payload: { ...log, id },
        label: `Food “${log.name}”`,
      });
      syncNow();
      return id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nutrition', 'recent'] }),
  });
}

export function useDeleteFoodLog() {
  return useMutation({
    mutationFn: async (log: Pick<FoodLog, 'id' | 'name'>) => {
      await enqueue({
        kind: 'delete_food_log',
        entityId: log.id,
        payload: null,
        label: `Delete “${log.name}”`,
      });
      syncNow();
    },
  });
}

/** Copies one meal from another day (new ids, so both stay). */
export function useCopyMeal() {
  const log = useLogFood();
  return useMutation({
    mutationFn: async ({ from, to, meal }: { from: FoodLog[]; to: string; meal: Meal }) => {
      for (const l of from) {
        await log.mutateAsync({ ...l, id: newId(), day: to, meal });
      }
      return from.length;
    },
  });
}

export function useAddWater() {
  return useMutation({
    mutationFn: async ({ day, ml }: { day: string; ml: number }) => {
      const w: WaterLog = { id: newId(), day, ml };
      await enqueue({ kind: 'save_water', entityId: w.id, payload: w, label: `Water +${ml} ml` });
      syncNow();
    },
  });
}

export function useRemoveWater() {
  return useMutation({
    mutationFn: async (w: WaterLog) => {
      await enqueue({
        kind: 'delete_water',
        entityId: w.id,
        payload: null,
        label: `Water −${w.ml} ml`,
      });
      syncNow();
    },
  });
}

export function useToggleFavorite() {
  return useMutation({
    mutationFn: async ({ food, favorite }: { food: Food; favorite: boolean }) => {
      await enqueue({
        kind: 'set_favorite',
        entityId: food.id,
        payload: { favorite, food },
        label: `${favorite ? 'Favourite' : 'Unfavourite'} “${food.name}”`,
      });
      syncNow();
    },
  });
}

// --- Admin -----------------------------------------------------------------------

export function useAdminFoods(query: string, hidden: boolean | null) {
  return useQuery({
    queryKey: ['admin', 'foods', query, hidden],
    queryFn: () => fetchAdminFoods(query, hidden),
  });
}

export function useSetFoodHidden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => setFoodHidden(id, hidden),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'foods'] }),
  });
}

export function useUpdateFood() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<FoodInput> }) =>
      updateFood(id, changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'foods'] }),
  });
}
