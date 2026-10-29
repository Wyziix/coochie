import { dateKey, groupByMonth, monthGrid, parseWorkoutTimes } from '@/lib/history/calendar';

describe('monthGrid', () => {
  it('starts on Monday and pads with neighbouring days', () => {
    // October 2026 starts on a Thursday.
    const weeks = monthGrid(2026, 9, new Date(2026, 9, 31));
    expect(weeks).toHaveLength(5);
    expect(weeks[0]!.map((d) => d.key)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks[0]![0]!.inMonth).toBe(false);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(weeks.flat().find((d) => d.isToday)?.key).toBe('2026-10-31');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('handles a month starting on Monday', () => {
    expect(monthGrid(2026, 5)[0]![0]!.key).toBe('2026-06-01'); // 1 June 2026 is a Monday
  });
});

describe('dateKey', () => {
  it('uses the local date', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('groupByMonth', () => {
  it('groups newest-first workouts by month', () => {
    const sections = groupByMonth([
      { started_at: new Date(2026, 9, 20).toISOString() },
      { started_at: new Date(2026, 9, 2).toISOString() },
      { started_at: new Date(2026, 8, 30).toISOString() },
    ]);
    expect(sections.map((s) => s.data.length)).toEqual([2, 1]);
  });
});

describe('parseWorkoutTimes', () => {
  const now = new Date(2026, 9, 31, 12);
  it('turns date + time + minutes into start and end', () => {
    const r = parseWorkoutTimes('2026-10-30', '18:30', '75', now);
    expect(r).toEqual({
      startedAt: new Date(2026, 9, 30, 18, 30),
      endedAt: new Date(2026, 9, 30, 19, 45),
    });
  });
  it('rejects bad input and the future', () => {
    expect(parseWorkoutTimes('30/10/2026', '18:30', '60', now)).toEqual({
      error: 'Date like 2026-10-31',
    });
    expect(parseWorkoutTimes('2026-02-30', '18:30', '60', now)).toEqual({
      error: 'That date doesn’t exist',
    });
    expect(parseWorkoutTimes('2026-10-30', '25:00', '60', now)).toEqual({
      error: 'Start time like 18:30',
    });
    expect(parseWorkoutTimes('2026-10-30', '18:30', '0', now)).toEqual({
      error: 'Duration 1–1440 minutes',
    });
    expect(parseWorkoutTimes('2026-11-05', '10:00', '60', now)).toEqual({
      error: 'Can’t be in the future',
    });
  });
});
