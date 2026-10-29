import type { Enums } from '@/types/database';

export type WeightUnit = Enums<'weight_unit'>;

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export const kgToLbs = (kg: number) => kg / KG_PER_LB;
export const lbsToKg = (lbs: number) => lbs * KG_PER_LB;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inches: number) => inches * CM_PER_IN;

export const round = (value: number, decimals = 1) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/** kg (as stored) -> number in the user's unit. */
export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return round(unit === 'lbs' ? kgToLbs(kg) : kg, 1);
}

/** Number in the user's unit -> kg for storage. */
export function fromDisplayWeight(value: number, unit: WeightUnit): number {
  return round(unit === 'lbs' ? lbsToKg(value) : value, 2);
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${toDisplayWeight(kg, unit)} ${unit}`;
}

/** Height follows the weight unit: cm for kg users, inches for lbs users. */
export const heightUnitFor = (unit: WeightUnit) => (unit === 'lbs' ? 'in' : 'cm');

export function toDisplayHeight(cm: number, unit: WeightUnit): number {
  return round(unit === 'lbs' ? cmToIn(cm) : cm, unit === 'lbs' ? 1 : 0);
}

export function fromDisplayHeight(value: number, unit: WeightUnit): number {
  return round(unit === 'lbs' ? inToCm(value) : value, 1);
}

export function formatHeight(cm: number, unit: WeightUnit): string {
  if (unit === 'lbs') {
    const totalIn = Math.round(cmToIn(cm));
    return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
  }
  return `${Math.round(cm)} cm`;
}
