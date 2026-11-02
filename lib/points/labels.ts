import type { FlagReason, Level, PointsItem, PointsReason } from '@/lib/api/points';

export const reasonLabels: Record<PointsReason, string> = {
  workout: 'Workout done',
  sets: 'Working sets',
  pr: 'Personal records',
  daily_cap: 'Daily limit',
  weekly_goal: 'Weekly goal hit',
  streak: 'Streak bonus',
};

/** "Working sets (14)", "Personal records: Bench Press", "Streak bonus (3 weeks)". */
export function describeItem(item: Pick<PointsItem, 'reason' | 'details'>): string {
  const d = item.details ?? {};
  switch (item.reason) {
    case 'sets':
      return `${reasonLabels.sets} (${d.working_sets ?? '?'})`;
    case 'pr': {
      const names = Array.isArray(d.exercises) ? (d.exercises as string[]) : [];
      return names.length ? `${reasonLabels.pr}: ${names.join(', ')}` : reasonLabels.pr;
    }
    case 'weekly_goal':
      return `${reasonLabels.weekly_goal} (${d.sessions ?? '?'} of ${d.goal ?? '?'} days)`;
    case 'streak':
      return `${reasonLabels.streak} (${d.weeks ?? '?'} weeks in a row)`;
    case 'daily_cap':
      return `${reasonLabels.daily_cap} (max ${d.cap ?? '?'} a day)`;
    default:
      return reasonLabels[item.reason] ?? item.reason;
  }
}

export const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`;

/** 0..1 progress from this level to the next (1 at the top level). */
export function levelProgress(level: Level): number {
  if (level.next_points == null) return 1;
  const span = level.next_points - level.min_points;
  return span > 0 ? Math.min(1, Math.max(0, (level.points - level.min_points) / span)) : 1;
}

/** For admins reviewing a flagged workout. */
export function describeFlag(f: FlagReason, unit: (kg: number) => string): string {
  switch (f.reason) {
    case 'unrealistic_weight':
      return `${f.exercise}: ${unit(f.weight_kg)} is above the believable ${unit(f.limit_kg)} for this bodyweight`;
    case 'big_jump':
      return `${f.exercise}: ${unit(f.weight_kg)}, previous best ${unit(f.previous_kg)}`;
    case 'too_short':
      return `Only ${f.minutes} minutes long`;
    case 'too_many_today':
      return `Workout number ${f.workout_of_the_day} that day`;
    case 'backdated':
      return `Logged ${f.days} days after it happened`;
  }
}
