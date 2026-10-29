import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import {
  backend,
  fakeProfile,
  fakeSession,
  onboardedProfile,
  resetBackend,
} from '@/test-utils/backend';

jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
jest.mock('@/lib/supabase', () => require('@/test-utils/backend').supabaseMock);
jest.mock('@/lib/api/profiles', () => require('@/test-utils/backend').profilesMock);
jest.mock('@/lib/api/progress', () => require('@/test-utils/backend').progressMock);
jest.mock('@/lib/api/body', () => require('@/test-utils/backend').bodyMock);
jest.mock('@/lib/api/photos', () => require('@/test-utils/backend').photosMock);
jest.mock('@/lib/api/ai', () => require('@/test-utils/backend').aiMock);
jest.mock('@/lib/api/photoLock', () => ({
  ...jest.requireActual('@/lib/api/photoLock'),
  ...require('@/test-utils/backend').photoLockMock,
}));
jest.mock('@/lib/photos/biometrics', () => require('@/test-utils/backend').biometricsMock);
jest.mock('@/lib/api/templates', () => require('@/test-utils/backend').templatesMock);
jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);
jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);

const appDir = path.resolve(__dirname, '../app');

describe('auth routing', () => {
  it('shows only the sign-in screen when logged out', async () => {
    resetBackend();
    await renderRouter(appDir, { initialUrl: '/profile' });
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeOnTheScreen();
  });

  it('sends a signed-in user without a finished profile to onboarding', async () => {
    resetBackend({ session: fakeSession(), profile: fakeProfile() });
    await renderRouter(appDir, { initialUrl: '/' });
    await waitFor(() => expect(screen).toHavePathname('/onboarding'));
  });

  it('opens the tabs for an onboarded user and switches between all of them', async () => {
    resetBackend({ session: fakeSession(), profile: onboardedProfile() });
    await renderRouter(appDir, { initialUrl: '/' });
    expect(await screen.findByText('Hi, Gleb')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');

    for (const tab of [
      { label: 'Workout', path: '/workout' },
      { label: 'Progress', path: '/progress' },
      { label: 'Ranking', path: '/ranking' },
      { label: 'Profile', path: '/profile' },
      { label: 'Home', path: '/' },
    ]) {
      await fireEvent.press(screen.getByRole('button', { name: new RegExp(tab.label) }));
      expect(screen).toHavePathname(tab.path);
    }
  });

  it('returns to sign-in after logging out', async () => {
    resetBackend({ session: fakeSession(), profile: onboardedProfile() });
    await renderRouter(appDir, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByText('@gleb')).toBeOnTheScreen());

    // confirm() uses Alert on native: auto-press the destructive button.
    const { Alert } = require('react-native');
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as { style?: string; onPress?: () => void }[];
      buttons.find((b) => b.style === 'destructive')?.onPress?.();
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
    expect(backend.session).toBeNull();
  });

  it('opens edit profile from the profile tab', async () => {
    resetBackend({ session: fakeSession(), profile: onboardedProfile() });
    await renderRouter(appDir, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByText('@gleb')).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    await waitFor(() => expect(screen).toHavePathname('/edit-profile'));
    await act(async () => {});
  });
});
