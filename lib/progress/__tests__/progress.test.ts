import type { HistoryPoint } from '@/lib/api/progress';
import { emptyForm, formToInput, latest } from '@/lib/progress/measurements';
import {
  formatRecordSet,
  formatRecordValue,
  groupByExercise,
  recordTypesFor,
} from '@/lib/progress/records';
import { bodyValue, change, exerciseSeries, rangeStart } from '@/lib/progress/series';
import { weekBounds } from '@/lib/progress/week';

const rec = (p: Partial<Parameters<typeof formatRecordValue>[0]>) => ({
  record_type: 'heaviest_weight' as const,
  value: 100,
  weight_kg: 100,
  reps: 5,
  ...p,
});

describe('record formatting', () => {
  it('formats each record type in the user’s unit', () => {
    expect(formatRecordValue(rec({}), 'kg')).toBe('100 kg');
    expect(formatRecordValue(rec({}), 'lbs')).toBe('220.5 lbs');
    expect(
      formatRecordValue(rec({ record_type: 'reps_at_weight', value: 8, weight_kg: 60 }), 'kg'),
    ).toBe('8 reps @ 60 kg');
    expect(
      formatRecordValue(rec({ record_type: 'reps_at_weight', value: 20, weight_kg: null }), 'kg'),
    ).toBe('20 reps');
    expect(formatRecordValue(rec({ record_type: 'longest_duration', value: 90 }), 'kg')).toBe(
      '1:30',
    );
    expect(formatRecordValue(rec({}), 'kg', 95)).toBe('95 kg');
  });

  it('shows the set behind e1RM and heaviest', () => {
    expect(formatRecordSet(rec({ record_type: 'best_e1rm', value: 116.67 }), 'kg')).toBe(
      'from 100 kg × 5',
    );
    expect(formatRecordSet(rec({}), 'kg')).toBe('× 5');
    expect(formatRecordSet(rec({ record_type: 'session_volume' }), 'kg')).toBeNull();
  });

  it('picks record cards by exercise type', () => {
    expect(recordTypesFor('weights')).toEqual(['heaviest_weight', 'best_e1rm', 'session_volume']);
    expect(recordTypesFor('timed')).toEqual(['longest_duration']);
    expect(recordTypesFor('cardio')).toEqual([]);
  });

  it('groups new records by exercise in server order', () => {
    const groups = groupByExercise([
      { exercise_id: 'a', exercise_name: 'A', n: 1 },
      { exercise_id: 'b', exercise_name: 'B', n: 2 },
      { exercise_id: 'a', exercise_name: 'A', n: 3 },
    ]);
    expect(groups.map((g) => [g.name, g.records.map((r) => r.n)])).toEqual([
      ['A', [1, 3]],
      ['B', [2]],
    ]);
  });
});

describe('chart series', () => {
  const h = (p: Partial<HistoryPoint>): HistoryPoint => ({
    workout_id: 'w',
    started_at: '2026-10-01T10:00:00Z',
    max_weight_kg: null,
    best_e1rm_kg: null,
    volume_kg: 0,
    total_reps: 0,
    max_duration_seconds: null,
    total_distance_m: null,
    ...p,
  });
  const history = [
    h({ max_weight_kg: 100, best_e1rm_kg: 116.67, volume_kg: 1500, total_reps: 15 }),
    h({ max_weight_kg: null, total_reps: 0 }),
    h({ max_weight_kg: 102.5, volume_kg: 1640.4 }),
  ];

  it('builds one point per session for the metric, in the user’s unit', () => {
    expect(exerciseSeries(history, 'weight', 'kg').map((p) => p.value)).toEqual([100, 102.5]);
    expect(exerciseSeries(history, 'weight', 'lbs').map((p) => p.value)).toEqual([220.5, 226]);
    expect(exerciseSeries(history, 'e1rm', 'kg').map((p) => p.value)).toEqual([116.7]);
    expect(exerciseSeries(history, 'volume', 'kg').map((p) => p.value)).toEqual([1500, 1640]);
  });

  it('change between first and last point', () => {
    expect(change(exerciseSeries(history, 'weight', 'kg'))).toBe(2.5);
    expect(change([])).toBeNull();
  });

  it('range start dates', () => {
    const now = new Date(2026, 9, 31);
    expect(rangeStart('1M', now)).toEqual(new Date(2026, 8, 31));
    expect(rangeStart('1Y', now)).toEqual(new Date(2025, 9, 31));
    expect(rangeStart('All', now)).toBeNull();
  });

  it('body values in display units', () => {
    expect(bodyValue(80, 'weight', 'lbs')).toBe(176.4);
    expect(bodyValue(100, 'length', 'lbs')).toBe(39.4);
    expect(bodyValue(15.5, 'percent', 'lbs')).toBe(15.5);
  });
});

describe('week bounds', () => {
  it('runs Monday to Monday in local time', () => {
    const { from, to } = weekBounds(new Date(2026, 10, 1, 15)); // Sunday 1 Nov 2026
    expect(from).toEqual(new Date(2026, 9, 26));
    expect(to).toEqual(new Date(2026, 10, 2));
  });
});

describe('measurement form', () => {
  it('converts to kg and cm and drops empty fields', () => {
    const form = { ...emptyForm(), bodyweight: '176', waist_cm: '32' };
    expect(formToInput(form, '2026-10-31', 'lbs')).toEqual({
      input: { measured_on: '2026-10-31', bodyweight_kg: 79.83, waist_cm: 81.3 },
      error: null,
    });
  });

  it('rejects empty and unrealistic input', () => {
    expect(formToInput(emptyForm(), '2026-10-31', 'kg').error).toBe('Enter at least one value');
    expect(formToInput({ ...emptyForm(), bodyweight: '5' }, '2026-10-31', 'kg').error).toBe(
      'Bodyweight doesn’t look right',
    );
    expect(formToInput({ ...emptyForm(), bodyFat: '90' }, '2026-10-31', 'kg').error).toBe(
      'Body fat should be 2–70 %',
    );
    expect(formToInput({ ...emptyForm(), chest_cm: '2' }, '2026-10-31', 'kg').error).toBe(
      'Chest doesn’t look right',
    );
  });

  it('latest value across entries', () => {
    const entries = [
      { bodyweight_kg: null, waist_cm: 80 },
      { bodyweight_kg: 81, waist_cm: 82 },
    ] as unknown as Parameters<typeof latest>[0];
    expect(latest(entries, 'bodyweight_kg')).toBe(81);
    expect(latest(entries, 'waist_cm')).toBe(80);
  });
});
