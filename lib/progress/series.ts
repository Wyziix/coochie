import type { HistoryPoint } from '@/lib/api/progress';
import { cmToIn, kgToLbs, round, type WeightUnit } from '@/lib/units';

export type Range = '1M' | '3M' | '6M' | '1Y' | 'All';
export const RANGES: Range[] = ['1M', '3M', '6M', '1Y', 'All'];

/** Start of a chart range, or null for all time. */
export function rangeStart(range: Range, now = new Date()): Date | null {
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, All: 0 }[range];
  if (!months) return null;
  return new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
}

export type Metric = 'weight' | 'e1rm' | 'volume' | 'reps' | 'duration';

export const metricLabels: Record<Metric, string> = {
  weight: 'Weight',
  e1rm: 'Est. 1RM',
  volume: 'Volume',
  reps: 'Reps',
  duration: 'Time',
};

export type Point = { date: string; value: number };

const toUnit = (kg: number, unit: WeightUnit) => round(unit === 'lbs' ? kgToLbs(kg) : kg, 1);

/** Chart points for one metric, oldest first, in the user's unit. Sessions without the metric are skipped. */
export function exerciseSeries(history: HistoryPoint[], metric: Metric, unit: WeightUnit): Point[] {
  const pick = (h: HistoryPoint): number | null => {
    switch (metric) {
      case 'weight':
        return h.max_weight_kg != null ? toUnit(h.max_weight_kg, unit) : null;
      case 'e1rm':
        return h.best_e1rm_kg != null ? toUnit(h.best_e1rm_kg, unit) : null;
      case 'volume':
        return h.volume_kg > 0 ? Math.round(toUnit(h.volume_kg, unit)) : null;
      case 'reps':
        return h.total_reps > 0 ? h.total_reps : null;
      case 'duration':
        return h.max_duration_seconds ?? null;
    }
  };
  return history
    .map((h) => ({ date: h.started_at, value: pick(h) }))
    .filter((p): p is Point => p.value !== null);
}

/** Converts a body measurement to the display unit (kg/lbs for weight, cm/in for lengths, % as is). */
export function bodyValue(
  value: number,
  kind: 'weight' | 'length' | 'percent',
  unit: WeightUnit,
): number {
  if (kind === 'weight') return toUnit(value, unit);
  if (kind === 'length') return round(unit === 'lbs' ? cmToIn(value) : value, 1);
  return value;
}

/** Short x-axis label: "3 Oct". */
export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });

/** Change from first to last point, e.g. +7.5. */
export function change(points: Point[]): number | null {
  if (points.length < 2) return null;
  return round(points.at(-1)!.value - points[0]!.value, 1);
}
