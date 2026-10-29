import { router } from 'expo-router';

import { ensureNotificationPermission } from '@/lib/platform/notifications';
import type { WeightUnit } from '@/lib/units';
import { useWorkoutStore } from '@/stores/workoutStore';

import { defaultWorkoutName } from './format';

/** Starts an empty workout and opens it. Asks for notification permission once (native). */
export function startEmptyWorkout(units: WeightUnit) {
  useWorkoutStore.getState().start(defaultWorkoutName(), units);
  ensureNotificationPermission().catch(() => {});
  router.push('/workouts/active');
}
