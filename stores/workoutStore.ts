import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Exercise } from '@/lib/api/exercises';
import { newId } from '@/lib/id';
import type { WeightUnit } from '@/lib/units';
import type { ActiveExercise, ActiveSet, ActiveWorkout, RestTimer } from '@/lib/workout/types';

const emptySet = (copyFrom?: ActiveSet): ActiveSet => ({
  id: newId(),
  type: copyFrom?.type === 'warmup' ? 'normal' : (copyFrom?.type ?? 'normal'),
  weight: copyFrom?.weight ?? '',
  reps: copyFrom?.reps ?? '',
  duration: copyFrom?.duration ?? '',
  distance: copyFrom?.distance ?? '',
  rpe: null,
  done: false,
});

type WorkoutState = {
  workout: ActiveWorkout | null;
  restTimer: RestTimer | null;

  start: (name: string, units: WeightUnit) => void;
  rename: (name: string) => void;
  discard: () => void;

  addExercises: (
    exercises: Exercise[],
    restFor: (e: Exercise) => number,
    setCounts?: number[],
  ) => void;
  removeExercise: (key: string) => void;
  setExerciseRest: (key: string, seconds: number) => void;

  addSet: (exerciseKey: string) => void;
  updateSet: (exerciseKey: string, setId: string, patch: Partial<ActiveSet>) => void;
  removeSet: (exerciseKey: string, setId: string) => void;

  startRest: (exerciseKey: string, seconds: number, notificationId: string | null) => void;
  setRestEnd: (endsAt: number, totalSeconds: number, notificationId: string | null) => void;
  clearRest: () => void;
};

const mapExercise = (
  workout: ActiveWorkout | null,
  key: string,
  fn: (e: ActiveExercise) => ActiveExercise,
): ActiveWorkout | null =>
  workout && { ...workout, exercises: workout.exercises.map((e) => (e.key === key ? fn(e) : e)) };

/**
 * The workout in progress. Persisted (AsyncStorage on native, localStorage on
 * web), so it survives the app being closed or the page being reloaded.
 */
export const useWorkoutStore = create<WorkoutState>()(
  persist(
    (set) => ({
      workout: null,
      restTimer: null,

      start: (name, units) =>
        set({
          workout: { id: newId(), name, startedAt: new Date().toISOString(), units, exercises: [] },
          restTimer: null,
        }),
      rename: (name) => set((s) => ({ workout: s.workout && { ...s.workout, name } })),
      discard: () => set({ workout: null, restTimer: null }),

      addExercises: (exercises, restFor, setCounts) =>
        set((s) => {
          if (!s.workout) return s;
          const added = exercises.map((e, i): ActiveExercise => ({
            key: newId(),
            exerciseId: e.id,
            name: e.name,
            type: e.type,
            restSeconds: restFor(e),
            sets: Array.from({ length: Math.max(1, setCounts?.[i] ?? 1) }, () => emptySet()),
          }));
          return { workout: { ...s.workout, exercises: [...s.workout.exercises, ...added] } };
        }),
      removeExercise: (key) =>
        set((s) => ({
          workout: s.workout && {
            ...s.workout,
            exercises: s.workout.exercises.filter((e) => e.key !== key),
          },
          restTimer: s.restTimer?.exerciseKey === key ? null : s.restTimer,
        })),
      setExerciseRest: (key, seconds) =>
        set((s) => ({
          workout: mapExercise(s.workout, key, (e) => ({ ...e, restSeconds: seconds })),
        })),

      addSet: (exerciseKey) =>
        set((s) => ({
          workout: mapExercise(s.workout, exerciseKey, (e) => ({
            ...e,
            sets: [...e.sets, emptySet(e.sets.at(-1))],
          })),
        })),
      updateSet: (exerciseKey, setId, patch) =>
        set((s) => ({
          workout: mapExercise(s.workout, exerciseKey, (e) => ({
            ...e,
            sets: e.sets.map((x) => (x.id === setId ? { ...x, ...patch } : x)),
          })),
        })),
      removeSet: (exerciseKey, setId) =>
        set((s) => ({
          workout: mapExercise(s.workout, exerciseKey, (e) => ({
            ...e,
            sets: e.sets.filter((x) => x.id !== setId),
          })),
        })),

      startRest: (exerciseKey, seconds, notificationId) =>
        set({
          restTimer: {
            exerciseKey,
            totalSeconds: seconds,
            endsAt: Date.now() + seconds * 1000,
            notificationId,
          },
        }),
      setRestEnd: (endsAt, totalSeconds, notificationId) =>
        set((s) => ({
          restTimer: s.restTimer && { ...s.restTimer, endsAt, totalSeconds, notificationId },
        })),
      clearRest: () => set({ restTimer: null }),
    }),
    {
      name: 'active-workout',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ workout: s.workout, restTimer: s.restTimer }),
    },
  ),
);

export const useHasActiveWorkout = () => useWorkoutStore((s) => s.workout !== null);
