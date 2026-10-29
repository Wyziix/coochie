import type { LastSet } from '@/lib/api/exercises';
import type { ExerciseType } from '@/lib/exercises/labels';
import { toDisplayWeight, type WeightUnit } from '@/lib/units';

import { formatDuration, metersToDisplay, parseDuration, parseNumber } from './format';
import type { ActiveSet } from './types';

/** Which inputs a set row shows for each exercise type. */
export const fieldsFor = (type: ExerciseType) => ({
  weight: type === 'weights' || type === 'bodyweight',
  reps: type === 'weights' || type === 'bodyweight',
  duration: type === 'timed' || type === 'cardio',
  distance: type === 'cardio',
});

export const durationUnitFor = (type: ExerciseType) => (type === 'cardio' ? 'minutes' : 'seconds');

/** Placeholder values for a set: last time's set at this index, as strings in the workout unit. */
export function placeholderFrom(last: LastSet | undefined, unit: WeightUnit): Partial<ActiveSet> {
  if (!last) return {};
  return {
    weight: last.weight_kg != null ? String(toDisplayWeight(last.weight_kg, unit)) : '',
    reps: last.reps != null ? String(last.reps) : '',
    duration: last.duration_seconds != null ? formatDuration(last.duration_seconds) : '',
    distance: last.distance_m != null ? String(metersToDisplay(last.distance_m, unit)) : '',
  };
}

/** "80 kg × 5", "× 12", "1:00", "25:00 · 5 km". */
export function formatLastSet(
  last: LastSet | undefined,
  type: ExerciseType,
  unit: WeightUnit,
): string {
  if (!last) return '–';
  const f = fieldsFor(type);
  const parts: string[] = [];
  if (f.reps) {
    const w =
      last.weight_kg != null && last.weight_kg > 0
        ? `${toDisplayWeight(last.weight_kg, unit)} ${unit} `
        : '';
    parts.push(`${w}× ${last.reps ?? 0}`.trim());
  }
  if (f.duration && last.duration_seconds != null)
    parts.push(formatDuration(last.duration_seconds));
  if (f.distance && last.distance_m != null) {
    parts.push(`${metersToDisplay(last.distance_m, unit)} ${unit === 'lbs' ? 'mi' : 'km'}`);
  }
  return parts.join(' · ') || '–';
}

/** Fills empty inputs from the placeholder, so "done" on an untouched row repeats last time. */
export function withPlaceholders(set: ActiveSet, placeholder: Partial<ActiveSet>): ActiveSet {
  return {
    ...set,
    weight: set.weight || placeholder.weight || '',
    reps: set.reps || placeholder.reps || '',
    duration: set.duration || placeholder.duration || '',
    distance: set.distance || placeholder.distance || '',
  };
}

/** Whether a set has what it needs to be marked done. */
export function isSetComplete(set: ActiveSet, type: ExerciseType): boolean {
  const f = fieldsFor(type);
  if (f.reps) {
    const reps = parseNumber(set.reps);
    if (reps === null || reps < 1 || !Number.isInteger(reps)) return false;
    const weight = parseNumber(set.weight);
    if (type === 'weights' && (weight === null || weight < 0)) return false;
    if (set.weight && (weight === null || weight < 0)) return false;
  }
  if (f.duration) {
    const d = parseDuration(set.duration, durationUnitFor(type));
    if (d === null || d <= 0) return false;
  }
  if (f.distance && set.distance && parseNumber(set.distance) === null) return false;
  return true;
}
