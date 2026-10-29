import type { Json } from '@/types/database';
import { fromDisplayWeight } from '@/lib/units';

import { displayToMeters, parseDuration, parseNumber } from './format';
import { durationUnitFor, fieldsFor } from './sets';
import type { ActiveWorkout } from './types';

/**
 * Turns the in-progress workout into the save_workout RPC arguments. Only
 * completed sets are sent; exercises without any are dropped and the rest
 * renumbered. Weights become kg, times seconds, distances meters.
 */
export function toSavePayload(workout: ActiveWorkout, endedAt: Date = new Date()) {
  const unit = workout.units;
  const sets: Json[] = [];
  let exerciseOrder = 0;

  for (const exercise of workout.exercises) {
    const done = exercise.sets.filter((s) => s.done);
    if (done.length === 0) continue;
    const f = fieldsFor(exercise.type);

    done.forEach((s, setOrder) => {
      const weight = f.weight ? parseNumber(s.weight) : null;
      const distance = f.distance ? parseNumber(s.distance) : null;
      sets.push({
        id: s.id,
        exercise_id: exercise.exerciseId,
        exercise_order: exerciseOrder,
        set_order: setOrder,
        set_type: s.type,
        weight_kg: weight !== null ? fromDisplayWeight(weight, unit) : null,
        reps: f.reps ? parseNumber(s.reps) : null,
        rpe: s.rpe,
        duration_seconds: f.duration
          ? parseDuration(s.duration, durationUnitFor(exercise.type))
          : null,
        distance_m: distance !== null ? displayToMeters(distance, unit) : null,
      });
    });
    exerciseOrder++;
  }

  return {
    p_workout: {
      id: workout.id,
      name: workout.name.trim() || 'Workout',
      started_at: workout.startedAt,
      ended_at: endedAt.toISOString(),
    },
    p_sets: sets,
  };
}

export function countSets(workout: ActiveWorkout) {
  let done = 0;
  let total = 0;
  for (const e of workout.exercises) {
    total += e.sets.length;
    done += e.sets.filter((s) => s.done).length;
  }
  return { done, total, undone: total - done };
}

/** Live volume in the workout's unit (working sets only), for the header. */
export function liveVolume(workout: ActiveWorkout): number {
  let volume = 0;
  for (const e of workout.exercises) {
    if (e.type !== 'weights' && e.type !== 'bodyweight') continue;
    for (const s of e.sets) {
      if (!s.done || s.type === 'warmup') continue;
      volume += (parseNumber(s.weight) ?? 0) * (parseNumber(s.reps) ?? 0);
    }
  }
  return Math.round(volume);
}
