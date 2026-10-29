import type { Exercise } from '@/lib/api/exercises';

import type { Equipment, MuscleGroup } from './labels';

export type ExerciseFilter = {
  query?: string;
  muscle?: MuscleGroup | null;
  equipment?: Equipment | null;
  includeHidden?: boolean;
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Every word of the query must appear in the name. Muscle matches primary or secondary. */
export function filterExercises(exercises: Exercise[], filter: ExerciseFilter): Exercise[] {
  const words = normalize(filter.query ?? '')
    .split(' ')
    .filter(Boolean);

  return exercises
    .filter((e) => filter.includeHidden || !e.is_hidden)
    .filter(
      (e) =>
        !filter.muscle ||
        e.primary_muscle === filter.muscle ||
        e.secondary_muscles.includes(filter.muscle),
    )
    .filter((e) => !filter.equipment || e.equipment === filter.equipment)
    .filter((e) => {
      if (words.length === 0) return true;
      const name = normalize(e.name);
      return words.every((w) => name.includes(w));
    })
    .sort((a, b) => {
      // Primary-muscle matches first, then alphabetical.
      if (filter.muscle) {
        const pa = a.primary_muscle === filter.muscle ? 0 : 1;
        const pb = b.primary_muscle === filter.muscle ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      return a.name.localeCompare(b.name);
    });
}

export type ExerciseListItem =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'exercise'; key: string; exercise: Exercise };

/**
 * Puts recently used exercises (in recency order) in a "Recent" section above
 * the rest. Without recent matches it's just the plain list.
 */
export function withRecentSection(results: Exercise[], recentIds: string[]): ExerciseListItem[] {
  const byId = new Map(results.map((e) => [e.id, e]));
  const recent = recentIds.map((id) => byId.get(id)).filter((e) => e !== undefined);
  const item = (e: Exercise): ExerciseListItem => ({ kind: 'exercise', key: e.id, exercise: e });
  if (recent.length === 0) return results.map(item);
  const recentSet = new Set(recent.map((e) => e.id));
  return [
    { kind: 'header', key: 'h-recent', title: 'Recent' },
    ...recent.map(item),
    { kind: 'header', key: 'h-all', title: 'All exercises' },
    ...results.filter((e) => !recentSet.has(e.id)).map(item),
  ];
}
