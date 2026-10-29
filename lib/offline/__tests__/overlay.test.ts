import type { WorkoutSummary } from '@/lib/api/workouts';
import type { OutboxItem } from '@/lib/offline/outbox';
import {
  overlayExercises,
  overlayRest,
  overlayWorkouts,
  workoutChanges,
  workoutDetailFromChange,
} from '@/lib/offline/overlay';
import { fakeExercise } from '@/test-utils/backend';

const item = (over: Partial<OutboxItem>): OutboxItem => ({
  id: Math.random().toString(),
  userId: 'u',
  kind: 'save_workout',
  entityId: 'w',
  payload: null,
  label: '',
  changedAt: '2026-10-29T12:00:00Z',
  attempts: 0,
  status: 'pending',
  ...over,
});

const payload = (id: string, startedAt: string, weight = 100) => ({
  p_workout: {
    id,
    name: `W ${id}`,
    started_at: startedAt,
    ended_at: new Date(Date.parse(startedAt) + 3600e3).toISOString(),
    template_id: null,
  },
  p_sets: [
    {
      id: `${id}-s1`,
      exercise_id: 'ex-bench',
      exercise_order: 0,
      set_order: 0,
      set_type: 'normal',
      weight_kg: weight,
      reps: 5,
      rpe: null,
      duration_seconds: null,
      distance_m: null,
    },
    {
      id: `${id}-s2`,
      exercise_id: 'ex-bench',
      exercise_order: 0,
      set_order: 1,
      set_type: 'warmup',
      weight_kg: 60,
      reps: 5,
      rpe: null,
      duration_seconds: null,
      distance_m: null,
    },
  ],
});

const server = (id: string, startedAt: string): WorkoutSummary => ({
  id,
  user_id: 'u',
  name: `Server ${id}`,
  started_at: startedAt,
  ended_at: startedAt,
  duration_seconds: 60,
  total_volume_kg: 1,
  notes: null,
  template_id: null,
  created_at: '',
  updated_at: '',
  client_updated_at: null,
  set_count: 1,
});

describe('overlayWorkouts', () => {
  it('adds queued workouts, replaces edited ones, hides deleted ones, newest first', () => {
    const list = [
      server('a', '2026-10-28T10:00:00Z'),
      server('b', '2026-10-27T10:00:00Z'),
      server('c', '2026-10-26T10:00:00Z'),
    ];
    const items = [
      item({ entityId: 'new', payload: payload('new', '2026-10-29T10:00:00Z') }),
      item({ entityId: 'b', payload: payload('b', '2026-10-27T10:00:00Z', 120) }),
      item({ kind: 'delete_workout', entityId: 'c' }),
    ];
    const out = overlayWorkouts(list, items);
    expect(out.map((w) => [w.id, w.sync ?? null])).toEqual([
      ['new', 'waiting'],
      ['a', null],
      ['b', 'waiting'],
    ]);
    expect(out[0]).toMatchObject({
      name: 'W new',
      duration_seconds: 3600,
      total_volume_kg: 500,
      set_count: 2,
    });
  });

  it('a delete the server refused is not applied', () => {
    const out = overlayWorkouts(
      [server('a', '2026-10-28T10:00:00Z')],
      [item({ kind: 'delete_workout', entityId: 'a', status: 'failed' })],
    );
    expect(out.map((w) => w.id)).toEqual(['a']);
  });

  it('only adds what fits (e.g. the calendar month) and can skip adding', () => {
    const items = [item({ entityId: 'n', payload: payload('n', '2026-09-30T10:00:00Z') })];
    const october = (w: WorkoutSummary) => w.started_at >= '2026-10-01';
    expect(overlayWorkouts([], items, { include: october })).toEqual([]);
    expect(overlayWorkouts([], items, { insertNew: false })).toEqual([]);
    expect(overlayWorkouts([], items)).toHaveLength(1);
  });

  it('marks a refused save as failed', () => {
    expect(
      overlayWorkouts(
        [],
        [item({ entityId: 'n', payload: payload('n', '2026-10-29T10:00:00Z'), status: 'failed' })],
      )[0]!.sync,
    ).toBe('failed');
  });
});

describe('workoutDetailFromChange', () => {
  it('builds the summary screen data from the queued workout', () => {
    const change = workoutChanges([
      item({ entityId: 'n', payload: payload('n', '2026-10-29T10:00:00Z') }),
    ]).get('n')!;
    if (change.deleted) throw new Error('unexpected');
    const detail = workoutDetailFromChange(
      change.payload,
      change.item,
      new Map([['ex-bench', fakeExercise({ id: 'ex-bench', name: 'Bench' })]]),
    );
    expect(detail.sets.map((s) => [s.exercise.name, s.weight_kg])).toEqual([
      ['Bench', 100],
      ['Bench', 60],
    ]);
    expect(detail.sync).toBe('waiting');
  });
});

describe('exercises and rest times', () => {
  it('adds custom exercises created offline, sorted by name', () => {
    const list = [
      fakeExercise({ id: 'b', name: 'Bench' }),
      fakeExercise({ id: 's', name: 'Squat' }),
    ];
    const out = overlayExercises(list, [
      item({
        kind: 'save_exercise',
        entityId: 'c',
        payload: {
          name: 'Cable fly',
          primary_muscle: 'chest',
          secondary_muscles: [],
          equipment: 'cable',
          type: 'weights',
          instructions: null,
          default_rest_seconds: 60,
        },
      }),
    ]);
    expect(out.map((e) => e.name)).toEqual(['Bench', 'Cable fly', 'Squat']);
    expect(out[1]).toMatchObject({ id: 'c', owner_id: 'u' });
  });

  it('applies rest times changed offline', () => {
    expect(
      overlayRest({ a: 60 }, [
        item({ kind: 'save_rest', entityId: 'b', payload: { seconds: 90 } }),
      ]),
    ).toEqual({ a: 60, b: 90 });
  });
});
