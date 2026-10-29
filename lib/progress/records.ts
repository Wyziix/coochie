import type { Enums } from '@/types/database';
import type { ExerciseType } from '@/lib/exercises/labels';
import { formatWeight, type WeightUnit } from '@/lib/units';
import { formatDuration } from '@/lib/workout/format';

export type RecordType = Enums<'record_type'>;

export const recordLabels: Record<RecordType, string> = {
  heaviest_weight: 'Heaviest weight',
  best_e1rm: 'Best est. 1RM',
  reps_at_weight: 'Most reps',
  session_volume: 'Best session volume',
  longest_duration: 'Longest hold',
};

type RecordLike = {
  record_type: RecordType;
  value: number;
  weight_kg: number | null;
  reps: number | null;
};

/** "100 kg", "8 reps @ 60 kg", "1:30". */
export function formatRecordValue(r: RecordLike, unit: WeightUnit, value = r.value): string {
  switch (r.record_type) {
    case 'heaviest_weight':
    case 'best_e1rm':
    case 'session_volume':
      return formatWeight(value, unit);
    case 'reps_at_weight':
      return r.weight_kg ? `${value} reps @ ${formatWeight(r.weight_kg, unit)}` : `${value} reps`;
    case 'longest_duration':
      return formatDuration(value);
  }
}

/** The set behind a record, e.g. "100 kg × 5". */
export function formatRecordSet(r: RecordLike, unit: WeightUnit): string | null {
  if (r.record_type === 'best_e1rm' && r.weight_kg && r.reps)
    return `from ${formatWeight(r.weight_kg, unit)} × ${r.reps}`;
  if (r.record_type === 'heaviest_weight' && r.reps) return `× ${r.reps}`;
  return null;
}

/** Which record cards an exercise detail shows, in order. */
export function recordTypesFor(type: ExerciseType): RecordType[] {
  if (type === 'timed') return ['longest_duration'];
  if (type === 'cardio') return [];
  if (type === 'bodyweight') return ['reps_at_weight', 'heaviest_weight'];
  return ['heaviest_weight', 'best_e1rm', 'session_volume'];
}

/** Groups new records by exercise, keeping the server's order. */
export function groupByExercise<T extends { exercise_id: string; exercise_name: string }>(
  records: T[],
) {
  const groups: { exerciseId: string; name: string; records: T[] }[] = [];
  for (const r of records) {
    let g = groups.find((x) => x.exerciseId === r.exercise_id);
    if (!g) groups.push((g = { exerciseId: r.exercise_id, name: r.exercise_name, records: [] }));
    g.records.push(r);
  }
  return groups;
}
