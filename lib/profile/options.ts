import type { OptionListItem, SegmentedOption } from '@/components/ui';
import type { Enums } from '@/types/database';

export type Goal = Enums<'training_goal'>;
export type ExperienceLevel = Enums<'experience_level'>;

export type ChoiceOption<T extends string> = OptionListItem<T>;

export const goalOptions: ChoiceOption<Goal>[] = [
  { value: 'strength', label: 'Strength', description: 'Lift heavier on the big lifts' },
  { value: 'hypertrophy', label: 'Muscle size', description: 'Build muscle (hypertrophy)' },
  { value: 'fat_loss', label: 'Fat loss', description: 'Keep muscle while losing fat' },
  { value: 'general_fitness', label: 'General fitness', description: 'Stay fit and healthy' },
];

export const experienceOptions: ChoiceOption<ExperienceLevel>[] = [
  { value: 'beginner', label: 'Beginner', description: 'Less than 1 year of regular training' },
  { value: 'intermediate', label: 'Intermediate', description: '1–3 years' },
  { value: 'advanced', label: 'Advanced', description: 'More than 3 years' },
];

export const unitOptions: SegmentedOption<'kg' | 'lbs'>[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lbs', label: 'lbs' },
];

export const trainingDayOptions: SegmentedOption<string>[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  value: String(n),
  label: String(n),
}));

export const labelFor = <T extends string>(options: ChoiceOption<T>[], value: T | null) =>
  options.find((o) => o.value === value)?.label ?? '–';
