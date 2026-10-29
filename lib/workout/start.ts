import { router } from 'expo-router';

import type { Template } from '@/lib/api/templates';
import { confirm } from '@/lib/confirm';
import { ensureNotificationPermission } from '@/lib/platform/notifications';
import type { WeightUnit } from '@/lib/units';
import { useWorkoutStore } from '@/stores/workoutStore';

import { defaultWorkoutName } from './format';
import { workoutFromTemplate } from './fromTemplate';

/** If a workout is already running, ask before replacing it. */
async function okToReplaceActive(): Promise<boolean> {
  const current = useWorkoutStore.getState().workout;
  if (!current) return true;
  return confirm({
    title: `Discard “${current.name}”?`,
    message: 'You have a workout in progress. Starting a new one deletes it.',
    confirmLabel: 'Discard and start',
    destructive: true,
  });
}

function open() {
  ensureNotificationPermission().catch(() => {});
  router.push('/workouts/active');
}

/** Starts an empty workout and opens it. Asks for notification permission once (native). */
export async function startEmptyWorkout(units: WeightUnit) {
  if (!(await okToReplaceActive())) return;
  useWorkoutStore.getState().start(defaultWorkoutName(), units);
  open();
}

/** One tap from the Workout tab: the template's exercises and empty sets, ready to log. */
export async function startTemplateWorkout(
  template: Template,
  units: WeightUnit,
  restSettings?: Record<string, number>,
) {
  if (!(await okToReplaceActive())) return;
  useWorkoutStore.getState().load(workoutFromTemplate(template, units, restSettings));
  open();
}
