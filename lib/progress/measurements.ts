import type { Measurement, MeasurementInput } from '@/lib/api/body';
import { fromDisplayWeight, inToCm, round, type WeightUnit } from '@/lib/units';
import { parseNumber } from '@/lib/workout/format';

export type MeasurementField = Exclude<
  keyof MeasurementInput,
  'measured_on' | 'notes' | 'bodyweight_kg' | 'body_fat_pct'
>;

export const lengthFields: { key: MeasurementField; label: string }[] = [
  { key: 'chest_cm', label: 'Chest' },
  { key: 'waist_cm', label: 'Waist' },
  { key: 'hips_cm', label: 'Hips' },
  { key: 'arm_cm', label: 'Arms' },
  { key: 'thigh_cm', label: 'Thighs' },
  { key: 'calf_cm', label: 'Calves' },
  { key: 'shoulders_cm', label: 'Shoulders' },
  { key: 'neck_cm', label: 'Neck' },
];

export type MeasurementForm = { bodyweight: string; bodyFat: string } & Record<
  MeasurementField,
  string
>;

export const emptyForm = (): MeasurementForm => ({
  bodyweight: '',
  bodyFat: '',
  ...(Object.fromEntries(lengthFields.map((f) => [f.key, ''])) as Record<MeasurementField, string>),
});

/**
 * Form (in the user's units) → row (kg / cm), or an error. Empty fields are
 * left out; at least one value is needed.
 */
export function formToInput(
  form: MeasurementForm,
  measuredOn: string,
  unit: WeightUnit,
): { input: MeasurementInput; error: null } | { input: null; error: string } {
  const input: MeasurementInput = { measured_on: measuredOn };
  const bw = parseNumber(form.bodyweight);
  if (form.bodyweight.trim()) {
    const kg = bw === null ? null : fromDisplayWeight(bw, unit);
    if (kg === null || kg < 20 || kg > 400)
      return { input: null, error: 'Bodyweight doesn’t look right' };
    input.bodyweight_kg = kg;
  }
  const fat = parseNumber(form.bodyFat);
  if (form.bodyFat.trim()) {
    if (fat === null || fat < 2 || fat > 70)
      return { input: null, error: 'Body fat should be 2–70 %' };
    input.body_fat_pct = fat;
  }
  for (const { key, label } of lengthFields) {
    if (!form[key].trim()) continue;
    const n = parseNumber(form[key]);
    const cm = n === null ? null : round(unit === 'lbs' ? inToCm(n) : n, 1);
    if (cm === null || cm < 10 || cm > 300)
      return { input: null, error: `${label} doesn’t look right` };
    input[key] = cm;
  }
  if (Object.keys(input).length === 1) return { input: null, error: 'Enter at least one value' };
  return { input, error: null };
}

/** The newest value of one field across entries (newest first). */
export function latest(entries: Measurement[], key: keyof Measurement): number | null {
  for (const e of entries) if (e[key] != null) return e[key] as number;
  return null;
}
