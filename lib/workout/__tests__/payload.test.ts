import { countSets, liveVolume, toSavePayload } from '@/lib/workout/payload';
import {
  formatLastSet,
  isSetComplete,
  placeholderFrom,
  withPlaceholders,
} from '@/lib/workout/sets';
import type { ActiveSet, ActiveWorkout } from '@/lib/workout/types';

const set = (p: Partial<ActiveSet>): ActiveSet => ({
  id: Math.random().toString(),
  type: 'normal',
  weight: '',
  reps: '',
  duration: '',
  distance: '',
  rpe: null,
  done: true,
  ...p,
});

const workout: ActiveWorkout = {
  id: 'w1',
  name: '  Push  ',
  startedAt: '2026-10-30T10:00:00.000Z',
  units: 'lbs',
  exercises: [
    {
      key: 'a',
      exerciseId: 'bench',
      name: 'Bench',
      type: 'weights',
      restSeconds: 120,
      sets: [
        set({ type: 'warmup', weight: '95', reps: '10' }),
        set({ weight: '185', reps: '5', rpe: 8 }),
        set({ weight: '185', reps: '5', done: false }),
      ],
    },
    {
      key: 'b',
      exerciseId: 'skipped',
      name: 'Fly',
      type: 'weights',
      restSeconds: 60,
      sets: [set({ done: false })],
    },
    {
      key: 'c',
      exerciseId: 'plank',
      name: 'Plank',
      type: 'timed',
      restSeconds: 60,
      sets: [set({ duration: '1:00' })],
    },
    {
      key: 'd',
      exerciseId: 'run',
      name: 'Run',
      type: 'cardio',
      restSeconds: 0,
      sets: [set({ duration: '20', distance: '2' })],
    },
  ],
};

describe('toSavePayload', () => {
  const { p_workout, p_sets } = toSavePayload(workout, new Date('2026-10-30T11:00:00.000Z'));
  const sets = p_sets as Record<string, unknown>[];

  it('sends only completed sets and renumbers exercises', () => {
    expect(sets).toHaveLength(4);
    expect(sets.map((s) => [s.exercise_id, s.exercise_order, s.set_order])).toEqual([
      ['bench', 0, 0],
      ['bench', 0, 1],
      ['plank', 1, 0],
      ['run', 2, 0],
    ]);
  });

  it('converts to kg, seconds and meters', () => {
    expect(sets[1]).toMatchObject({ weight_kg: 83.91, reps: 5, rpe: 8, set_type: 'normal' });
    expect(sets[0]).toMatchObject({ set_type: 'warmup', weight_kg: 43.09 });
    expect(sets[2]).toMatchObject({ duration_seconds: 60, weight_kg: null, reps: null });
    expect(sets[3]).toMatchObject({ duration_seconds: 1200, distance_m: 3218.7 });
  });

  it('trims the name and sets end time', () => {
    expect(p_workout).toEqual({
      id: 'w1',
      name: 'Push',
      started_at: '2026-10-30T10:00:00.000Z',
      ended_at: '2026-10-30T11:00:00.000Z',
      template_id: null,
    });
  });

  it('counts sets and live volume (working sets, workout unit)', () => {
    expect(countSets(workout)).toEqual({ done: 4, total: 6, undone: 2 });
    expect(liveVolume(workout)).toBe(925);
  });
});

describe('set helpers', () => {
  const last = {
    exercise_id: 'bench',
    set_index: 1,
    set_type: 'normal' as const,
    weight_kg: 100,
    reps: 5,
    rpe: null,
    duration_seconds: null,
    distance_m: null,
    performed_at: '',
  };

  it('formats last time', () => {
    expect(formatLastSet(last, 'weights', 'kg')).toBe('100 kg × 5');
    expect(formatLastSet({ ...last, weight_kg: null, reps: 12 }, 'bodyweight', 'kg')).toBe('× 12');
    expect(formatLastSet(undefined, 'weights', 'kg')).toBe('–');
  });

  it('fills empty fields from last time when marking done', () => {
    const filled = withPlaceholders(set({ done: false, reps: '6' }), placeholderFrom(last, 'kg'));
    expect(filled).toMatchObject({ weight: '100', reps: '6' });
  });

  it('knows when a set is complete', () => {
    expect(isSetComplete(set({ weight: '100', reps: '5' }), 'weights')).toBe(true);
    expect(isSetComplete(set({ reps: '5' }), 'weights')).toBe(false);
    expect(isSetComplete(set({ reps: '0' }), 'bodyweight')).toBe(false);
    expect(isSetComplete(set({ reps: '12' }), 'bodyweight')).toBe(true);
    expect(isSetComplete(set({ duration: '' }), 'timed')).toBe(false);
    expect(isSetComplete(set({ duration: '0:45' }), 'timed')).toBe(true);
  });
});
