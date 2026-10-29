import { round, type WeightUnit } from '@/lib/units';

/** 65 -> "1:05", 3725 -> "1:02:05". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Duration for summaries: "1h 05m", "42m". */
export function formatDurationShort(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * Parses what someone types into a time cell. "1:30" = 1 min 30 s, "1:02:00"
 * = 1 h 2 min. A bare number uses `bareUnit` (seconds for planks, minutes for
 * runs). Returns seconds, or null if it isn't a time.
 */
export function parseDuration(text: string, bareUnit: 'seconds' | 'minutes'): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    return t
      .split(':')
      .map(Number)
      .reduce((acc, n) => acc * 60 + n, 0);
  }
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(bareUnit === 'minutes' ? n * 60 : n);
}

export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const distanceUnitFor = (unit: WeightUnit) => (unit === 'lbs' ? 'mi' : 'km');
const METERS_PER: Record<'km' | 'mi', number> = { km: 1000, mi: 1609.344 };

export function metersToDisplay(meters: number, unit: WeightUnit): number {
  return round(meters / METERS_PER[distanceUnitFor(unit)], 2);
}

export function displayToMeters(value: number, unit: WeightUnit): number {
  return round(value * METERS_PER[distanceUnitFor(unit)], 1);
}

export function formatRest(seconds: number): string {
  return seconds === 0 ? 'Off' : formatDuration(seconds);
}

export const REST_OPTIONS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];

export function defaultWorkoutName(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Night workout';
  if (h < 12) return 'Morning workout';
  if (h < 17) return 'Afternoon workout';
  return 'Evening workout';
}

/** "3 × 8–12", "5 × 5", "2 × 0:45". */
export function formatTarget(target: {
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  durationSeconds: number | null;
}): string {
  const what = target.durationSeconds
    ? formatDuration(target.durationSeconds)
    : target.repsMin && target.repsMax && target.repsMax !== target.repsMin
      ? `${target.repsMin}–${target.repsMax}`
      : target.repsMin
        ? String(target.repsMin)
        : null;
  return what ? `${target.sets} × ${what}` : `${target.sets} sets`;
}
