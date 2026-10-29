/** Local calendar date as "YYYY-MM-DD" (not UTC: a 23:30 workout belongs to that evening). */
export function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type CalendarDay = { key: string; day: number; inMonth: boolean; isToday: boolean };

/**
 * Weeks (Monday first) covering a month, padded with days from the months
 * around it so every row has 7 days.
 */
export function monthGrid(year: number, month: number, today = new Date()): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - offset);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const todayKey = dateKey(today);

  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
      return {
        key: dateKey(d),
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: dateKey(d) === todayKey,
      };
    }),
  );
}

/** The first and last instants of a month, for the date-range query. */
export function monthRange(year: number, month: number): { from: Date; to: Date } {
  return { from: new Date(year, month, 1), to: new Date(year, month + 1, 1) };
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Groups workouts (newest first) into month sections for the history list. */
export function groupByMonth<T extends { started_at: string }>(
  items: T[],
): { title: string; key: string; data: T[] }[] {
  const sections: { title: string; key: string; data: T[] }[] = [];
  for (const item of items) {
    const d = new Date(item.started_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let section = sections.at(-1);
    if (!section || section.key !== key) {
      section = { key, title: monthLabel(d.getFullYear(), d.getMonth()), data: [] };
      sections.push(section);
    }
    section.data.push(item);
  }
  return sections;
}

/**
 * Splits "date + start time + duration" typed in the edit form into the
 * start/end instants, or an error message.
 */
export function parseWorkoutTimes(
  date: string,
  time: string,
  durationMinutes: string,
  now = new Date(),
): { startedAt: Date; endedAt: Date } | { error: string } {
  const dm = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dm) return { error: 'Date like 2026-10-31' };
  const tm = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return { error: 'Start time like 18:30' };
  const minutes = Number(durationMinutes.trim());
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60)
    return { error: 'Duration 1–1440 minutes' };

  const [, y, mo, d] = dm.map(Number) as [number, number, number, number];
  const [, h, mi] = tm.map(Number) as [number, number, number];
  if (h > 23 || mi > 59) return { error: 'Start time like 18:30' };
  const startedAt = new Date(y, mo - 1, d, h, mi);
  if (startedAt.getMonth() !== mo - 1 || startedAt.getDate() !== d)
    return { error: 'That date doesn’t exist' };
  if (startedAt.getTime() > now.getTime()) return { error: 'Can’t be in the future' };
  return { startedAt, endedAt: new Date(startedAt.getTime() + Math.round(minutes) * 60_000) };
}
