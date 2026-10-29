import { fromDisplayHeight, fromDisplayWeight, type WeightUnit } from '@/lib/units';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** Returns an error message, or null when valid. Mirrors the DB check constraint. */
export function validateUsername(input: string): string | null {
  const name = normalizeUsername(input);
  if (name.length < 3) return 'At least 3 characters';
  if (name.length > 20) return 'At most 20 characters';
  if (!USERNAME_PATTERN.test(name)) return 'Only letters, numbers and _';
  return null;
}

export function validateDisplayName(input: string): string | null {
  return input.trim().length > 50 ? 'At most 50 characters' : null;
}

function parseNumber(input: string): number | null {
  const n = Number(input.trim().replace(',', '.'));
  return input.trim() !== '' && Number.isFinite(n) ? n : null;
}

type Parsed = { value: number; error: null } | { value: null; error: string };

/** Parses bodyweight typed in the user's unit and returns kg. */
export function parseBodyweight(input: string, unit: WeightUnit): Parsed {
  const n = parseNumber(input);
  if (n === null) return { value: null, error: 'Enter a number' };
  const kg = fromDisplayWeight(n, unit);
  if (kg < 20 || kg > 400) return { value: null, error: 'That doesn’t look right' };
  return { value: kg, error: null };
}

/** Parses optional height typed in cm (kg users) or inches (lbs users) and returns cm. */
export function parseHeight(
  input: string,
  unit: WeightUnit,
): Parsed | { value: null; error: null } {
  if (input.trim() === '') return { value: null, error: null };
  const n = parseNumber(input);
  if (n === null) return { value: null, error: 'Enter a number' };
  const cm = fromDisplayHeight(n, unit);
  if (cm < 100 || cm > 250) return { value: null, error: 'That doesn’t look right' };
  return { value: cm, error: null };
}
