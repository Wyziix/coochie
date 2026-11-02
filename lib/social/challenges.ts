import type { Challenge, ChallengeMetric } from '@/lib/api/social';

export const metricLabels: Record<ChallengeMetric, string> = {
  workouts: 'Workouts',
  sets: 'Working sets',
  points: 'Points',
  exercise: 'Sets of one exercise',
};

/** "12 workouts", "40 sets of Bench Press (Barbell)". */
export function scoreLabel(
  c: Pick<Challenge, 'metric' | 'exercise'>,
  score: number | null,
): string {
  const n = Math.round((score ?? 0) * 10) / 10;
  switch (c.metric) {
    case 'workouts':
      return `${n} workout${n === 1 ? '' : 's'}`;
    case 'points':
      return `${n} points`;
    case 'sets':
      return `${n} set${n === 1 ? '' : 's'}`;
    case 'exercise':
      return `${n} set${n === 1 ? '' : 's'} of ${c.exercise ?? 'the exercise'}`;
  }
}

/** "Ends today at midnight", "3 days left", "Starts Mon 3 Nov", "Finished". */
export function timeLeft(
  c: Pick<Challenge, 'state' | 'start_date' | 'ends_at'>,
  now = Date.now(),
): string {
  if (c.state === 'finished') return 'Finished';
  if (c.state === 'upcoming') {
    return `Starts ${new Date(`${c.start_date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
  }
  const hours = (Date.parse(c.ends_at) - now) / 3_600_000;
  if (hours <= 24) return 'Ends tonight at midnight (Madrid)';
  const days = Math.ceil(hours / 24);
  return `${days} days left`;
}

/** YYYY-MM-DD in Europe/Madrid, `offsetDays` from today. */
export function madridDate(offsetDays = 0, now = new Date()): string {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
}
