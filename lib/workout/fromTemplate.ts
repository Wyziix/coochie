import type { WorkoutDetail } from '@/lib/api/workouts';
import type { Template } from '@/lib/api/templates';
import { newId } from '@/lib/id';
import { toDisplayWeight, type WeightUnit } from '@/lib/units';

import { formatDuration, metersToDisplay } from './format';
import type { ActiveSet, ActiveWorkout } from './types';

const blankSet = (): ActiveSet => ({
  id: newId(),
  type: 'normal',
  weight: '',
  reps: '',
  duration: '',
  distance: '',
  rpe: null,
  done: false,
});

/**
 * A new workout from a template: its exercises in order, the target number
 * of (empty) sets, targets shown as hints. Rest: template → user's setting →
 * exercise default. Hidden exercises are kept (the template still works).
 */
export function workoutFromTemplate(
  template: Template,
  units: WeightUnit,
  restSettings: Record<string, number> = {},
  now = new Date(),
): ActiveWorkout {
  return {
    id: newId(),
    name: template.name,
    startedAt: now.toISOString(),
    units,
    templateId: template.id,
    exercises: template.exercises.map((te) => ({
      key: newId(),
      exerciseId: te.exercise_id,
      name: te.exercise.name,
      type: te.exercise.type,
      restSeconds:
        te.rest_seconds ?? restSettings[te.exercise_id] ?? te.exercise.default_rest_seconds,
      sets: Array.from({ length: te.target_sets }, blankSet),
      target: {
        sets: te.target_sets,
        repsMin: te.target_reps_min,
        repsMax: te.target_reps_max,
        durationSeconds: te.target_duration_seconds,
      },
    })),
  };
}

/** A saved workout loaded for editing: every set is done, values shown in the user's unit. */
export function workoutForEditing(detail: WorkoutDetail, units: WeightUnit): ActiveWorkout {
  const exercises: ActiveWorkout['exercises'] = [];
  for (const s of detail.sets) {
    let block = exercises.at(-1);
    if (!block || block.key !== `order-${s.exercise_order}`) {
      block = {
        key: `order-${s.exercise_order}`,
        exerciseId: s.exercise_id,
        name: s.exercise.name,
        type: s.exercise.type,
        restSeconds: 0,
        sets: [],
      };
      exercises.push(block);
    }
    block.sets.push({
      id: s.id,
      type: s.set_type,
      weight: s.weight_kg != null ? String(toDisplayWeight(s.weight_kg, units)) : '',
      reps: s.reps != null ? String(s.reps) : '',
      duration: s.duration_seconds != null ? formatDuration(s.duration_seconds) : '',
      distance: s.distance_m != null ? String(metersToDisplay(s.distance_m, units)) : '',
      rpe: s.rpe,
      done: true,
    });
  }
  return {
    id: detail.id,
    name: detail.name,
    startedAt: detail.started_at,
    units,
    templateId: detail.template_id,
    exercises,
  };
}
