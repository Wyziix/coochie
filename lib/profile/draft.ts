import type { Profile, ProfileUpdate } from '@/lib/api/profiles';
import {
  fromDisplayHeight,
  fromDisplayWeight,
  toDisplayHeight,
  toDisplayWeight,
  type WeightUnit,
} from '@/lib/units';

import type { ExperienceLevel, Goal } from './options';
import {
  normalizeUsername,
  parseBodyweight,
  parseHeight,
  validateDisplayName,
  validateUsername,
} from './validation';

/** Form state for onboarding and profile editing. Numbers are kept as typed, in the chosen unit. */
export type ProfileDraft = {
  username: string;
  displayName: string;
  units: WeightUnit;
  goal: Goal | null;
  experienceLevel: ExperienceLevel | null;
  trainingDays: number | null;
  bodyweight: string;
  height: string;
};

export type DraftField = keyof ProfileDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

export function draftFromProfile(profile: Profile | null | undefined): ProfileDraft {
  const units = profile?.units ?? 'kg';
  return {
    username: profile?.username ?? '',
    displayName: profile?.display_name ?? '',
    units,
    goal: profile?.goal ?? null,
    experienceLevel: profile?.experience_level ?? null,
    trainingDays: profile?.training_days_per_week ?? null,
    bodyweight:
      profile?.bodyweight_kg != null ? String(toDisplayWeight(profile.bodyweight_kg, units)) : '',
    height: profile?.height_cm != null ? String(toDisplayHeight(profile.height_cm, units)) : '',
  };
}

/** Switches units and converts any numbers already typed so they keep their meaning. */
export function changeUnits(draft: ProfileDraft, units: WeightUnit): ProfileDraft {
  if (units === draft.units) return draft;
  const convert = (
    value: string,
    to: (kgOrCm: number, u: WeightUnit) => number,
    from: typeof fromDisplayWeight,
  ) => {
    const n = Number(value.replace(',', '.'));
    if (value.trim() === '' || !Number.isFinite(n)) return value;
    return String(to(from(n, draft.units), units));
  };
  return {
    ...draft,
    units,
    bodyweight: convert(draft.bodyweight, toDisplayWeight, fromDisplayWeight),
    height: convert(draft.height, toDisplayHeight, fromDisplayHeight),
  };
}

/** Validates a single field. Used per onboarding step and for the full edit form. */
export function validateField(draft: ProfileDraft, field: DraftField): string | null {
  switch (field) {
    case 'username':
      return validateUsername(draft.username);
    case 'displayName':
      return validateDisplayName(draft.displayName);
    case 'goal':
      return draft.goal ? null : 'Pick a goal';
    case 'experienceLevel':
      return draft.experienceLevel ? null : 'Pick your experience level';
    case 'trainingDays':
      return draft.trainingDays ? null : 'Pick how many days';
    case 'bodyweight':
      return parseBodyweight(draft.bodyweight, draft.units).error;
    case 'height':
      return parseHeight(draft.height, draft.units).error;
    case 'units':
      return null;
  }
}

const ALL_FIELDS: DraftField[] = [
  'username',
  'displayName',
  'units',
  'goal',
  'experienceLevel',
  'trainingDays',
  'bodyweight',
  'height',
];

export function validateDraft(draft: ProfileDraft, fields: DraftField[] = ALL_FIELDS): DraftErrors {
  const errors: DraftErrors = {};
  for (const field of fields) {
    const error = validateField(draft, field);
    if (error) errors[field] = error;
  }
  return errors;
}

/** Converts a valid draft to a DB update (kg / cm). Call validateDraft first. */
export function draftToUpdate(draft: ProfileDraft): ProfileUpdate {
  return {
    username: normalizeUsername(draft.username),
    display_name: draft.displayName.trim() || null,
    units: draft.units,
    goal: draft.goal,
    experience_level: draft.experienceLevel,
    training_days_per_week: draft.trainingDays,
    bodyweight_kg: parseBodyweight(draft.bodyweight, draft.units).value,
    height_cm: parseHeight(draft.height, draft.units).value,
  };
}
