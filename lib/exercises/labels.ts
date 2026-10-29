import type { Enums } from '@/types/database';

export type MuscleGroup = Enums<'muscle_group'>;
export type Equipment = Enums<'equipment'>;
export type ExerciseType = Enums<'exercise_type'>;
export type SetType = Enums<'set_type'>;

export const muscleLabels: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  lower_back: 'Lower back',
  traps: 'Traps',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  adductors: 'Adductors',
  full_body: 'Full body',
  cardio: 'Cardio',
};

export const equipmentLabels: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  band: 'Band',
  smith_machine: 'Smith machine',
  ez_bar: 'EZ bar',
  cardio_machine: 'Cardio machine',
  other: 'Other',
};

export const typeLabels: Record<ExerciseType, string> = {
  weights: 'Weight + reps',
  bodyweight: 'Bodyweight reps',
  timed: 'Timed',
  cardio: 'Cardio (time + distance)',
};

export const setTypeLabels: Record<SetType, { label: string; short: string }> = {
  warmup: { label: 'Warm-up', short: 'W' },
  normal: { label: 'Normal', short: '' },
  drop: { label: 'Drop set', short: 'D' },
  failure: { label: 'To failure', short: 'F' },
};

const entries = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

export const muscleOptions = entries(muscleLabels);
export const equipmentOptions = entries(equipmentLabels);
export const typeOptions = entries(typeLabels);
