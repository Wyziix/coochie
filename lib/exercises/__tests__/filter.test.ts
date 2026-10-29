import type { Exercise } from '@/lib/api/exercises';
import { filterExercises } from '@/lib/exercises/filter';

const ex = (p: Partial<Exercise>): Exercise => ({
  id: p.name!,
  slug: null,
  name: '',
  primary_muscle: 'chest',
  secondary_muscles: [],
  equipment: 'barbell',
  type: 'weights',
  instructions: null,
  default_rest_seconds: 90,
  owner_id: null,
  is_hidden: false,
  created_at: '',
  updated_at: '',
  ...p,
});

const list = [
  ex({ name: 'Bench Press (Barbell)', secondary_muscles: ['triceps'] }),
  ex({ name: 'Bench Press (Dumbbell)', equipment: 'dumbbell' }),
  ex({ name: 'Tricep Pushdown (Cable)', primary_muscle: 'triceps', equipment: 'cable' }),
  ex({ name: 'Old Exercise', is_hidden: true }),
];

const names = (r: Exercise[]) => r.map((e) => e.name);

describe('filterExercises', () => {
  it('matches every word, ignoring case and punctuation', () => {
    expect(names(filterExercises(list, { query: 'bench dumb' }))).toEqual([
      'Bench Press (Dumbbell)',
    ]);
    expect(names(filterExercises(list, { query: 'PRESS barbell' }))).toEqual([
      'Bench Press (Barbell)',
    ]);
  });

  it('filters by muscle (primary first, then secondary) and equipment', () => {
    expect(names(filterExercises(list, { muscle: 'triceps' }))).toEqual([
      'Tricep Pushdown (Cable)',
      'Bench Press (Barbell)',
    ]);
    expect(names(filterExercises(list, { equipment: 'dumbbell' }))).toEqual([
      'Bench Press (Dumbbell)',
    ]);
  });

  it('leaves hidden exercises out unless asked', () => {
    expect(names(filterExercises(list, {}))).not.toContain('Old Exercise');
    expect(names(filterExercises(list, { includeHidden: true }))).toContain('Old Exercise');
  });
});
