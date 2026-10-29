import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { profilesMock } from '@/test-utils/backend';
import { backend, fakeProfile, fakeSession, resetBackend, USER_ID } from '@/test-utils/backend';

jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
jest.mock('@/lib/supabase', () => require('@/test-utils/backend').supabaseMock);
jest.mock('@/lib/api/profiles', () => require('@/test-utils/backend').profilesMock);
jest.mock('@/lib/api/progress', () => require('@/test-utils/backend').progressMock);
jest.mock('@/lib/api/body', () => require('@/test-utils/backend').bodyMock);
jest.mock('@/lib/api/photos', () => require('@/test-utils/backend').photosMock);
jest.mock('@/lib/api/photoLock', () => ({
  ...jest.requireActual('@/lib/api/photoLock'),
  ...require('@/test-utils/backend').photoLockMock,
}));
jest.mock('@/lib/photos/biometrics', () => require('@/test-utils/backend').biometricsMock);
jest.mock('@/lib/api/templates', () => require('@/test-utils/backend').templatesMock);
jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);
jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);

const appDir = path.resolve(__dirname, '../app');

const next = () => fireEvent.press(screen.getByRole('button', { name: 'Next' }));

describe('onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetBackend({ session: fakeSession(), profile: fakeProfile() });
  });

  it('walks through every step, saves in kg and lands on Home', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    await waitFor(() => expect(screen).toHavePathname('/onboarding'));

    // Username: blocked until the server says it's free.
    await fireEvent.changeText(screen.getByLabelText('Username'), 'Gleb_Lifts');
    await waitFor(() => expect(screen.getByText('Available')).toBeOnTheScreen());
    await next();

    await fireEvent.press(screen.getByRole('radio', { name: 'lbs' }));
    await next();
    await fireEvent.press(screen.getByRole('radio', { name: 'Strength' }));
    await next();
    await fireEvent.press(screen.getByRole('radio', { name: 'Beginner' }));
    await next();
    await fireEvent.press(screen.getByRole('radio', { name: '4' }));
    await next();

    await fireEvent.changeText(screen.getByLabelText('Bodyweight (lbs)'), '176');
    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(screen).toHavePathname('/'));
    expect(profilesMock.saveProfile).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        username: 'gleb_lifts',
        units: 'lbs',
        goal: 'strength',
        experience_level: 'beginner',
        training_days_per_week: 4,
        bodyweight_kg: 79.83,
        onboarding_completed_at: expect.any(String),
      }),
    );
    expect(backend.profile?.onboarding_completed_at).toBeTruthy();
  });

  it('shows when a username is taken and keeps Next disabled', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    await waitFor(() => expect(screen).toHavePathname('/onboarding'));
    await fireEvent.changeText(screen.getByLabelText('Username'), 'taken');
    await waitFor(() => expect(screen.getByText('That username is taken')).toBeOnTheScreen());
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('flags an invalid username without asking the server', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    await waitFor(() => expect(screen).toHavePathname('/onboarding'));
    await fireEvent.changeText(screen.getByLabelText('Username'), 'ab');
    expect(screen.getByText('At least 3 characters')).toBeOnTheScreen();
    expect(profilesMock.isUsernameAvailable).not.toHaveBeenCalled();
  });
});
