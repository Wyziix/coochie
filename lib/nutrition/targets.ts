import type { Goal } from '@/lib/profile/options';

export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'very' | 'extra';

export const activityOptions: {
  value: Activity;
  label: string;
  factor: number;
  description: string;
}[] = [
  {
    value: 'sedentary',
    label: 'Mostly sitting',
    factor: 1.2,
    description: 'Desk job, little walking',
  },
  { value: 'light', label: 'Light', factor: 1.375, description: 'Training 1–3 days a week' },
  { value: 'moderate', label: 'Moderate', factor: 1.55, description: 'Training 3–5 days a week' },
  { value: 'very', label: 'Very active', factor: 1.725, description: 'Training 6–7 days a week' },
  { value: 'extra', label: 'Extra active', factor: 1.9, description: 'Physical job plus training' },
];

const goalAdjust: Record<Goal, { factor: number; label: string; proteinPerKg: number }> = {
  fat_loss: { factor: 0.8, label: '−20% to lose fat slowly', proteinPerKg: 2.2 },
  hypertrophy: { factor: 1.1, label: '+10% to build muscle', proteinPerKg: 2.0 },
  strength: { factor: 1.05, label: '+5% for strength', proteinPerKg: 1.8 },
  general_fitness: { factor: 1, label: 'maintenance', proteinPerKg: 1.6 },
};

export type Suggestion = {
  bmr: number;
  tdee: number;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  water_ml: number;
  steps: string[];
};

/**
 * Mifflin-St Jeor: BMR = 10 × kg + 6.25 × cm − 5 × age + 5 (men) / − 161 (women),
 * × activity factor = maintenance, adjusted for the goal. Protein from
 * bodyweight, fat 25% of calories (at least 0.6 g/kg), the rest carbs.
 */
export function suggestTargets(input: {
  sex: Sex;
  age: number;
  weightKg: number;
  heightCm: number;
  activity: Activity;
  goal: Goal;
}): Suggestion {
  const { sex, age, weightKg: kg, heightCm: cm, activity, goal } = input;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
  const act = activityOptions.find((a) => a.value === activity)!;
  const tdee = bmr * act.factor;
  const g = goalAdjust[goal];
  const kcal = Math.round((tdee * g.factor) / 10) * 10;
  const protein = Math.round(kg * g.proteinPerKg);
  const fat = Math.round(Math.max((kcal * 0.25) / 9, kg * 0.6));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    kcal,
    protein_g: protein,
    fat_g: fat,
    carbs_g: carbs,
    water_ml: Math.round((kg * 35) / 50) * 50,
    steps: [
      `BMR (Mifflin-St Jeor) = 10 × ${round(kg)} kg + 6.25 × ${round(cm)} cm − 5 × ${age} ${sex === 'male' ? '+ 5' : '− 161'} = ${Math.round(bmr)} kcal`,
      `× ${act.factor} (${act.label.toLowerCase()}) = ${Math.round(tdee)} kcal to maintain`,
      `${g.label}: ${kcal} kcal`,
      `Protein ${g.proteinPerKg} g per kg = ${protein} g · fat 25% of calories = ${fat} g · carbs the rest = ${carbs} g`,
    ],
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
