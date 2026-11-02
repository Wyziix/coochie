import { FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabase } from '@/lib/supabase';

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Food = {
  id: string;
  source: 'off' | 'user';
  barcode: string | null;
  name: string;
  brand: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  serving_g: number | null;
  serving_label: string | null;
  owner_id: string | null;
  is_hidden?: boolean;
};

export type FoodLog = {
  id: string;
  day: string;
  meal: Meal;
  food_id: string | null;
  name: string;
  grams: number | null;
  servings: number | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  created_at?: string;
};

export type WaterLog = { id: string; day: string; ml: number; created_at?: string };

export type Targets = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_ml: number;
  method: 'manual' | 'mifflin_st_jeor';
  details: Record<string, unknown>;
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}
const table = (name: string) => getSupabase().from(name as never);

export async function fetchDay(day: string): Promise<{ logs: FoodLog[]; water: WaterLog[] }> {
  const [logs, water] = await Promise.all([
    table('food_logs')
      .select(
        'id, day, meal, food_id, name, grams, servings, kcal, protein, carbs, fat, created_at',
      )
      .eq('day', day)
      .order('created_at'),
    table('water_logs').select('id, day, ml, created_at').eq('day', day).order('created_at'),
  ]);
  if (logs.error) throw logs.error;
  if (water.error) throw water.error;
  return { logs: logs.data as unknown as FoodLog[], water: water.data as unknown as WaterLog[] };
}

/** Logs in [from, to] for the weekly view (totals only). */
export async function fetchRange(
  from: string,
  to: string,
): Promise<{ logs: FoodLog[]; water: WaterLog[] }> {
  const [logs, water] = await Promise.all([
    table('food_logs')
      .select('id, day, meal, food_id, name, grams, servings, kcal, protein, carbs, fat')
      .gte('day', from)
      .lte('day', to),
    table('water_logs').select('id, day, ml').gte('day', from).lte('day', to),
  ]);
  if (logs.error) throw logs.error;
  if (water.error) throw water.error;
  return { logs: logs.data as unknown as FoodLog[], water: water.data as unknown as WaterLog[] };
}

export async function fetchTargets(): Promise<Targets | null> {
  const { data, error } = await table('nutrition_targets')
    .select('kcal, protein_g, carbs_g, fat_g, water_ml, method, details')
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Targets | null;
}

export async function saveTargets(userId: string, targets: Targets): Promise<Targets> {
  const { error } = await table('nutrition_targets').upsert({
    user_id: userId,
    ...targets,
    updated_at: new Date().toISOString(),
  } as never);
  if (error) throw error;
  return targets;
}

export async function fetchFavorites(): Promise<Food[]> {
  const { data, error } = await table('food_favorites')
    .select('created_at, food:foods(*)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as { food: Food | null }[])
    .map((r) => r.food)
    .filter((f): f is Food => !!f);
}

/** Foods from my last logs, most recent first, no duplicates. */
export async function fetchRecentFoods(): Promise<Food[]> {
  const { data, error } = await table('food_logs')
    .select('created_at, food:foods(*)')
    .not('food_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) throw error;
  const seen = new Set<string>();
  const out: Food[] = [];
  for (const r of data as unknown as { food: Food | null }[]) {
    if (r.food && !seen.has(r.food.id)) {
      seen.add(r.food.id);
      out.push(r.food);
    }
  }
  return out.slice(0, 25);
}

/** A refusal or failure from food-search, with the message to show. */
export class FoodSearchError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FoodSearchError';
  }
}

async function foodSearch<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('food-search', { body });
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    const parsed = await res.json().catch(() => null);
    if (res.status === 404 && !parsed?.error) {
      throw Object.assign(new Error('The food-search Edge Function isn’t deployed yet.'), {
        code: 'EDGE_FUNCTION_MISSING',
      });
    }
    throw new FoodSearchError(
      parsed?.error ?? `http_${res.status}`,
      parsed?.message ?? error.message,
    );
  }
  if (error) throw error;
  return data as T;
}

export const searchFoods = (query: string) =>
  foodSearch<{ foods: Food[]; partial: boolean }>({ query });
export const lookupBarcode = (barcode: string) =>
  foodSearch<
    { found: true; food: Food; from: string } | { found: false; barcode: string; reason?: string }
  >({ barcode });

export type FoodInput = Pick<
  Food,
  | 'name'
  | 'brand'
  | 'barcode'
  | 'kcal_100g'
  | 'protein_100g'
  | 'carbs_100g'
  | 'fat_100g'
  | 'serving_g'
  | 'serving_label'
>;
export const saveMyFood = (food: FoodInput, id: string | null = null) =>
  rpc<Food>('save_my_food', { p_id: id, p_food: food });

// --- Sync queue (offline-first) -------------------------------------------------

export const saveFoodLog = (log: FoodLog, changedAt: string) =>
  rpc<FoodLog | null>('save_food_log', { p_log: { ...log, client_updated_at: changedAt } });
export const deleteFoodLogAt = (id: string, deletedAt: string) =>
  rpc<null>('delete_food_log_at', { p_id: id, p_deleted_at: deletedAt });
export const saveWaterLog = (w: WaterLog, changedAt: string) =>
  rpc<WaterLog | null>('save_water_log', {
    p_id: w.id,
    p_day: w.day,
    p_ml: w.ml,
    p_changed_at: changedAt,
  });
export const deleteWaterLogAt = (id: string, deletedAt: string) =>
  rpc<null>('delete_water_log_at', { p_id: id, p_deleted_at: deletedAt });
export const setFoodFavorite = (foodId: string, favorite: boolean) =>
  rpc<null>('set_food_favorite', { p_food: foodId, p_favorite: favorite });

// --- Admin (cached Open Food Facts foods only; logged) ---------------------------

export type AdminFood = Food & {
  times_logged: number;
  fetched_at: string | null;
  updated_at: string;
};
export const fetchAdminFoods = (query = '', hidden: boolean | null = null) =>
  rpc<AdminFood[]>('admin_foods', { p_query: query, p_hidden: hidden });
export const setFoodHidden = (id: string, hidden: boolean) =>
  rpc<null>('admin_set_food_hidden', { p_id: id, p_hidden: hidden });
export const updateFood = (id: string, changes: Partial<FoodInput>) =>
  rpc<AdminFood>('admin_update_food', { p_id: id, p_changes: changes });
