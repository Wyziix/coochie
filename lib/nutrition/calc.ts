import type { Food, FoodLog, Meal, WaterLog } from '@/lib/api/nutrition';

export const meals: { value: Meal; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snacks' },
];
export const mealLabel = (m: Meal) => meals.find((x) => x.value === m)!.label;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Values for a portion (same rule as the server): grams, or servings × serving size. */
export function portion(
  food: Pick<Food, 'kcal_100g' | 'protein_100g' | 'carbs_100g' | 'fat_100g' | 'serving_g'>,
  amount: { grams?: number | null; servings?: number | null },
) {
  const g =
    amount.grams ??
    (amount.servings != null && food.serving_g ? amount.servings * food.serving_g : null);
  if (g == null || !Number.isFinite(g)) return null;
  return {
    grams: r1(g),
    kcal: r1((food.kcal_100g * g) / 100),
    protein: r1((food.protein_100g * g) / 100),
    carbs: r1((food.carbs_100g * g) / 100),
    fat: r1((food.fat_100g * g) / 100),
  };
}

export type Totals = { kcal: number; protein: number; carbs: number; fat: number };

export function totals(logs: Pick<FoodLog, 'kcal' | 'protein' | 'carbs' | 'fat'>[]): Totals {
  const t = logs.reduce(
    (a, l) => ({
      kcal: a.kcal + Number(l.kcal),
      protein: a.protein + Number(l.protein),
      carbs: a.carbs + Number(l.carbs),
      fat: a.fat + Number(l.fat),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) };
}

export const waterTotal = (water: Pick<WaterLog, 'ml'>[]) => water.reduce((a, w) => a + w.ml, 0);

/** YYYY-MM-DD for the device's local day, `offset` days from `base`. */
export function localDay(offset = 0, base = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return localDay(0, new Date(y, m - 1, d + n));
}

export function dayLabel(day: string, today = localDay()): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "100 g", "1.5 × 15 g serving". */
export function portionLabel(
  log: Pick<FoodLog, 'grams' | 'servings'>,
  food?: Pick<Food, 'serving_label'> | null,
): string {
  if (log.servings != null)
    return `${r1(log.servings)} × ${food?.serving_label ?? 'serving'}${log.grams ? ` (${Math.round(log.grams)} g)` : ''}`;
  if (log.grams != null) return `${Math.round(log.grams)} g`;
  return 'Quick add';
}
