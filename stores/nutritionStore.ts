import { create } from 'zustand';

import type { Food, Meal } from '@/lib/api/nutrition';

/** Where food is being added (day and meal) and the food picked. */
export const useNutritionStore = create<{
  day: string | null;
  meal: Meal;
  food: Food | null;
  setTarget: (day: string, meal: Meal) => void;
  pick: (food: Food) => void;
}>()((set) => ({
  day: null,
  meal: 'breakfast',
  food: null,
  setTarget: (day, meal) => set({ day, meal }),
  pick: (food) => set({ food }),
}));
