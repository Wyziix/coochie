import type { WorkoutDetail } from '@/lib/api/workouts';
import { template } from '@/test-utils/fixtures';
import { workoutForEditing, workoutFromTemplate } from '@/lib/workout/fromTemplate';
import { toSavePayload } from '@/lib/workout/payload';

describe('workoutFromTemplate', () => {
  const w = workoutFromTemplate(template, 'kg', { plank: 30 }, new Date('2026-10-31T10:00:00Z'));

  it('uses the template name, exercises, set counts and targets', () => {
    expect(w).toMatchObject({
      name: 'Push',
      templateId: 't1',
      units: 'kg',
      startedAt: '2026-10-31T10:00:00.000Z',
    });
    expect(w.exercises.map((e) => [e.name, e.sets.length])).toEqual([
      ['Bench', 4],
      ['Plank', 2],
    ]);
    expect(w.exercises[0]!.target).toEqual({
      sets: 4,
      repsMin: 6,
      repsMax: 8,
      durationSeconds: null,
    });
    expect(w.exercises[0]!.sets.every((s) => !s.done && s.reps === '')).toBe(true);
  });

  it('rest: template value, else the user’s setting, else the exercise default', () => {
    expect(w.exercises.map((e) => e.restSeconds)).toEqual([180, 30]);
    expect(workoutFromTemplate(template, 'kg').exercises[1]!.restSeconds).toBe(60);
  });

  it('is saved with its template id', () => {
    expect(toSavePayload(w).p_workout).toMatchObject({ template_id: 't1' });
  });
});

describe('workoutForEditing', () => {
  const detail = {
    id: 'w1',
    user_id: 'u',
    name: 'Push',
    started_at: '2026-10-01T18:00:00Z',
    ended_at: '2026-10-01T19:00:00Z',
    duration_seconds: 3600,
    total_volume_kg: 0,
    notes: null,
    template_id: 't1',
    created_at: '',
    updated_at: '',
    sets: [
      {
        id: 's1',
        exercise_order: 0,
        set_order: 0,
        exercise_id: 'bench',
        set_type: 'warmup',
        weight_kg: 40,
        reps: 10,
        rpe: null,
        duration_seconds: null,
        distance_m: null,
        exercise: { id: 'bench', name: 'Bench', type: 'weights' },
      },
      {
        id: 's2',
        exercise_order: 0,
        set_order: 1,
        exercise_id: 'bench',
        set_type: 'normal',
        weight_kg: 100,
        reps: 5,
        rpe: 8,
        duration_seconds: null,
        distance_m: null,
        exercise: { id: 'bench', name: 'Bench', type: 'weights' },
      },
      {
        id: 's3',
        exercise_order: 1,
        set_order: 0,
        exercise_id: 'plank',
        set_type: 'normal',
        weight_kg: null,
        reps: null,
        rpe: null,
        duration_seconds: 60,
        distance_m: null,
        exercise: { id: 'plank', name: 'Plank', type: 'timed' },
      },
    ],
  } as unknown as WorkoutDetail;

  it('loads every set as done, in the user’s unit', () => {
    const w = workoutForEditing(detail, 'lbs');
    expect(w).toMatchObject({ id: 'w1', templateId: 't1', units: 'lbs' });
    expect(
      w.exercises.map((e) => e.sets.map((s) => [s.weight, s.reps, s.duration, s.done])),
    ).toEqual([
      [
        ['88.2', '10', '', true],
        ['220.5', '5', '', true],
      ],
      [['', '', '1:00', true]],
    ]);
  });

  it('saving unchanged keeps the same sets (ids and values)', () => {
    const p = toSavePayload(workoutForEditing(detail, 'kg'), new Date('2026-10-01T19:00:00Z'));
    expect(p.p_workout).toMatchObject({ id: 'w1', started_at: '2026-10-01T18:00:00Z' });
    expect(
      (p.p_sets as { id: string; weight_kg: number | null }[]).map((s) => [s.id, s.weight_kg]),
    ).toEqual([
      ['s1', 40],
      ['s2', 100],
      ['s3', null],
    ]);
  });
});
