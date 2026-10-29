import {
  changeUnits,
  draftFromProfile,
  draftToUpdate,
  validateDraft,
  type ProfileDraft,
} from '@/lib/profile/draft';
import { fakeProfile } from '@/test-utils/backend';

const complete: ProfileDraft = {
  username: 'Gleb_Lifts',
  displayName: ' Gleb ',
  units: 'lbs',
  goal: 'strength',
  experienceLevel: 'beginner',
  trainingDays: 4,
  bodyweight: '176',
  height: '',
};

describe('profile draft', () => {
  it('builds from a profile, showing numbers in the profile unit', () => {
    const draft = draftFromProfile(
      fakeProfile({ units: 'lbs', bodyweight_kg: 80, height_cm: 180 }),
    );
    expect(draft.bodyweight).toBe('176.4');
    expect(draft.height).toBe('70.9');
  });

  it('starts empty without a profile', () => {
    expect(draftFromProfile(null)).toMatchObject({ username: '', units: 'kg', goal: null });
  });

  it('converts typed numbers when switching units', () => {
    const kg = changeUnits(complete, 'kg');
    expect(kg.units).toBe('kg');
    expect(kg.bodyweight).toBe('79.8');
    expect(changeUnits({ ...complete, bodyweight: '' }, 'kg').bodyweight).toBe('');
  });

  it('reports every invalid field', () => {
    const errors = validateDraft({ ...complete, username: 'x', goal: null, bodyweight: '' });
    expect(Object.keys(errors).sort()).toEqual(['bodyweight', 'goal', 'username']);
    expect(validateDraft(complete)).toEqual({});
  });

  it('maps to a DB update in kg with a normalized username', () => {
    expect(draftToUpdate(complete)).toEqual({
      username: 'gleb_lifts',
      display_name: 'Gleb',
      units: 'lbs',
      goal: 'strength',
      experience_level: 'beginner',
      training_days_per_week: 4,
      bodyweight_kg: 79.83,
      height_cm: null,
    });
  });
});
