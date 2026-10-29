import type { TemplatePayload } from '@/lib/api/templates';
import type { WorkoutDetail } from '@/lib/api/workouts';

/**
 * A template from a finished workout: same exercises in order, number of
 * working sets, and the rep range done. Same rules as the server's
 * template_from_workout, but built on the device so it works offline too.
 */
export function templatePayloadFromWorkout(workout: WorkoutDetail, name: string): TemplatePayload {
  const blocks: WorkoutDetail['sets'][] = [];
  for (const s of workout.sets) {
    const last = blocks.at(-1);
    if (last && last[0]!.exercise_order === s.exercise_order) last.push(s);
    else blocks.push([s]);
  }
  return {
    p_template: { name: name.trim().slice(0, 60), notes: null },
    p_exercises: blocks.map((sets) => {
      const working = sets.filter((s) => s.set_type !== 'warmup');
      const reps = working.map((s) => s.reps ?? 0).filter((r) => r > 0);
      const min = reps.length ? Math.min(100, Math.min(...reps)) : null;
      const max = reps.length ? Math.min(100, Math.max(...reps)) : null;
      const durations = sets.map((s) => s.duration_seconds ?? 0).filter((d) => d > 0);
      return {
        exercise_id: sets[0]!.exercise_id,
        target_sets: Math.min(20, Math.max(1, working.length)),
        target_reps_min: min,
        target_reps_max: max !== null && min !== null && max > min ? max : null,
        target_duration_seconds: durations.length ? Math.max(...durations) : null,
        rest_seconds: null,
      };
    }),
  };
}
