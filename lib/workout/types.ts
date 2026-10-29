import type { ExerciseType, SetType } from '@/lib/exercises/labels';
import type { WeightUnit } from '@/lib/units';

/**
 * A set while the workout is in progress. Numbers are kept as typed (in the
 * workout's unit) so inputs never fight the user; they're converted to kg /
 * seconds / meters only when saving.
 */
export type ActiveSet = {
  id: string;
  type: SetType;
  weight: string;
  reps: string;
  duration: string;
  distance: string;
  rpe: number | null;
  done: boolean;
};

export type ActiveExercise = {
  key: string;
  exerciseId: string;
  name: string;
  type: ExerciseType;
  restSeconds: number;
  sets: ActiveSet[];
};

export type ActiveWorkout = {
  id: string;
  name: string;
  startedAt: string;
  units: WeightUnit;
  exercises: ActiveExercise[];
};

export type RestTimer = {
  endsAt: number;
  totalSeconds: number;
  exerciseKey: string;
  notificationId: string | null;
};
