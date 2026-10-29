import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { exercisesMock, fakeSession, onboardedProfile, resetBackend } from '@/test-utils/backend';

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
jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);
jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);

const appDir = path.resolve(__dirname, '../app');

describe('admin tab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is not shown to normal users, and /admin redirects them away', async () => {
    resetBackend({ session: fakeSession(), profile: onboardedProfile() });
    await renderRouter(appDir, { initialUrl: '/admin' });
    await waitFor(() => expect(screen).toHavePathname('/'));
    expect(screen.queryByRole('button', { name: /Admin/ })).toBeNull();
  });

  it('is shown to admins, who can hide a global exercise', async () => {
    const { Alert } = require('react-native');
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      (args[2] as { onPress?: () => void }[]).at(-1)?.onPress?.();
    });

    resetBackend({ session: fakeSession(), profile: onboardedProfile({ role: 'admin' }) });
    await renderRouter(appDir, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: /Admin/ }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Exercise library' }));
    // Admin list includes hidden exercises.
    expect(await screen.findByText('Old Hidden Move')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Squat (Barbell)' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Hide from library' }));
    await waitFor(() =>
      expect(exercisesMock.adminSetExerciseHidden).toHaveBeenCalledWith('ex-squat', true),
    );
  });
});
