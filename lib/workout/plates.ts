import type { WeightUnit } from '@/lib/units';

export const PLATES: Record<WeightUnit, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lbs: [45, 35, 25, 10, 5, 2.5],
};

export const BARS: Record<WeightUnit, number[]> = {
  kg: [20, 15, 10],
  lbs: [45, 35, 25],
};

export type PlateResult =
  | {
      ok: true;
      perSide: { plate: number; count: number }[];
      /** Total that can actually be loaded (may be below target). */
      loaded: number;
      /** target - loaded, when the target can't be hit exactly. */
      remainder: number;
    }
  | { ok: false; error: string };

/** Greedy plate breakdown per side. Works in the user's unit; math in hundredths to avoid float drift. */
export function calculatePlates(target: number, bar: number, plates: number[]): PlateResult {
  if (!Number.isFinite(target) || target <= 0) return { ok: false, error: 'Enter a target weight' };
  if (target < bar) return { ok: false, error: 'Target is lighter than the bar' };

  const toInt = (n: number) => Math.round(n * 100);
  let perSideLeft = Math.floor((toInt(target) - toInt(bar)) / 2);
  const perSide: { plate: number; count: number }[] = [];

  for (const plate of [...plates].sort((a, b) => b - a)) {
    const p = toInt(plate);
    const count = Math.floor(perSideLeft / p);
    if (count > 0) {
      perSide.push({ plate, count });
      perSideLeft -= count * p;
    }
  }

  const loadedInt =
    toInt(bar) + 2 * perSide.reduce((sum, { plate, count }) => sum + toInt(plate) * count, 0);
  return {
    ok: true,
    perSide,
    loaded: loadedInt / 100,
    remainder: Math.round(toInt(target) - loadedInt) / 100,
  };
}
