import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';
import { AppState, type AppStateStatus } from 'react-native';

import { usePhotoLockStore } from '@/stores/photoLockStore';
import {
  biometricsState,
  fakeSession,
  onboardedProfile,
  photoLockMock,
  photoLockState,
  photosMock,
  resetBackend,
  resetPhotoLock,
  resetProgress,
} from '@/test-utils/backend';

jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
jest.mock('@/lib/supabase', () => require('@/test-utils/backend').supabaseMock);
jest.mock('@/lib/api/profiles', () => require('@/test-utils/backend').profilesMock);
jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);
jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);
jest.mock('@/lib/api/templates', () => require('@/test-utils/backend').templatesMock);
jest.mock('@/lib/api/progress', () => require('@/test-utils/backend').progressMock);
jest.mock('@/lib/api/body', () => require('@/test-utils/backend').bodyMock);
jest.mock('@/lib/api/photos', () => require('@/test-utils/backend').photosMock);
jest.mock('@/lib/api/ai', () => require('@/test-utils/backend').aiMock);
jest.mock('@/lib/api/photoLock', () => ({
  ...jest.requireActual('@/lib/api/photoLock'),
  ...require('@/test-utils/backend').photoLockMock,
}));
jest.mock('@/lib/photos/biometrics', () => require('@/test-utils/backend').biometricsMock);
jest.mock('@/lib/photos/reset', () => require('@/test-utils/backend').resetMock);
jest.mock('@/lib/platform/notifications', () => ({
  ensureNotificationPermission: jest.fn(async () => true),
  scheduleRestNotification: jest.fn(async () => null),
  cancelRestNotification: jest.fn(async () => {}),
}));

const appDir = path.resolve(__dirname, '../app');

let appStateListeners: ((s: AppStateStatus) => void)[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  resetProgress();
  resetBackend({ session: fakeSession(), profile: onboardedProfile() });
  usePhotoLockStore.setState({ token: null, expiresAt: null, pickerOpen: false, notice: null });
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (s: AppStateStatus) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    ((args[2] as { onPress?: () => void }[] | undefined) ?? []).at(-1)?.onPress?.();
  });
});

async function enter(secret: string) {
  await fireEvent.changeText(await screen.findByLabelText('PIN'), secret);
  await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
}

describe('photo lock', () => {
  it('asks for a PIN the first time and opens the photos after', async () => {
    resetPhotoLock('setup');
    await renderRouter(appDir, { initialUrl: '/photos' });
    expect(await screen.findByText('Lock your progress photos')).toBeOnTheScreen();
    expect(photosMock.fetchPhotos).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('New PIN (4–6 digits)'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Save and open photos' }));
    expect(screen.getByText('PIN must be 4 to 6 digits.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('New PIN (4–6 digits)'), '1357');
    await fireEvent.changeText(screen.getByLabelText('Repeat PIN'), '1358');
    await fireEvent.press(screen.getByRole('button', { name: 'Save and open photos' }));
    expect(screen.getByText('PINs don’t match.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Repeat PIN'), '1357');
    await fireEvent.press(screen.getByRole('button', { name: 'Save and open photos' }));
    expect(await screen.findByRole('button', { name: 'Add photo' })).toBeOnTheScreen();
    expect(photoLockMock.setupLock).toHaveBeenCalledWith('pin', '1357');
    expect(photosMock.fetchPhotos).toHaveBeenCalledWith('tok-1');
  });

  it('can use a password instead', async () => {
    resetPhotoLock('setup');
    await renderRouter(appDir, { initialUrl: '/photos' });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Password' }));
    await fireEvent.changeText(
      screen.getByLabelText('New password (at least 6 characters)'),
      'squat-day',
    );
    await fireEvent.changeText(screen.getByLabelText('Repeat password'), 'squat-day');
    await fireEvent.press(screen.getByRole('button', { name: 'Save and open photos' }));
    await waitFor(() =>
      expect(photoLockMock.setupLock).toHaveBeenCalledWith('password', 'squat-day'),
    );
  });

  it('counts wrong PINs and locks for 15 minutes after 5', async () => {
    await renderRouter(appDir, { initialUrl: '/photos' });
    expect(await screen.findByText('Photos are locked')).toBeOnTheScreen();
    await enter('0000');
    expect(await screen.findByText(/Wrong PIN\. 4 attempts left/)).toBeOnTheScreen();
    for (let i = 0; i < 3; i++) await enter('0000');
    expect(await screen.findByText(/Wrong PIN\. 1 attempt left/)).toBeOnTheScreen();
    await enter('0000');
    expect(
      await screen.findByText(/Too many wrong attempts\. Try again in 15 min/),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('PIN')).toBeNull();
    expect(photosMock.fetchPhotos).not.toHaveBeenCalled();
    // The server refuses even the right PIN while locked.
    expect((await photoLockMock.unlockPhotos({ secret: '2580' })).ok).toBe(false);
  });

  it('re-locks when leaving the photos, and hides them on the Progress tab', async () => {
    await renderRouter(appDir, { initialUrl: '/photos' });
    await enter('2580');
    expect(await screen.findByRole('button', { name: 'Add photo' })).toBeOnTheScreen();
    expect(usePhotoLockStore.getState().token).toBe('tok-1');

    const { router } = require('expo-router');
    await act(() => router.replace('/progress'));
    await waitFor(() => expect(usePhotoLockStore.getState().token).toBeNull());
    expect(photoLockMock.relockPhotos).toHaveBeenCalledWith('tok-1');
    expect(await screen.findByText('Locked · 2 photos')).toBeOnTheScreen();
    expect(screen.getByLabelText('Locked')).toBeOnTheScreen();

    await act(() => router.push('/photos'));
    expect(await screen.findByText('Photos are locked')).toBeOnTheScreen();
  });

  it('re-locks when the app goes to the background, not while the picker is open', async () => {
    await renderRouter(appDir, { initialUrl: '/photos' });
    await enter('2580');
    await screen.findByRole('button', { name: 'Add photo' });

    usePhotoLockStore.getState().setPickerOpen(true);
    await act(async () => appStateListeners.forEach((l) => l('background')));
    expect(usePhotoLockStore.getState().token).toBe('tok-1');

    usePhotoLockStore.getState().setPickerOpen(false);
    await act(async () => appStateListeners.forEach((l) => l('background')));
    expect(await screen.findByText('Photos are locked')).toBeOnTheScreen();
    expect(photoLockMock.relockPhotos).toHaveBeenCalledWith('tok-1');
  });

  it('re-locks when the unlock expires', async () => {
    photoLockMock.unlockPhotos.mockImplementationOnce(async () => {
      photoLockState.tokens.add('short');
      return { ok: true, token: 'short', expires_at: new Date(Date.now() + 300).toISOString() };
    });
    await renderRouter(appDir, { initialUrl: '/photos' });
    await enter('2580');
    await screen.findByRole('button', { name: 'Add photo' });
    expect(await screen.findByText('Photos are locked', {}, { timeout: 2000 })).toBeOnTheScreen();
  });

  it('shows the lock again when the server refuses the token', async () => {
    await renderRouter(appDir, { initialUrl: '/photos' });
    await enter('2580');
    await screen.findByRole('button', { name: 'Add photo' });
    photoLockState.tokens.clear(); // e.g. PIN changed on another device
    await fireEvent.press(await screen.findByRole('button', { name: 'front photo, 2026-10-20' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete photo' }));
    expect(await screen.findByText('Photos are locked')).toBeOnTheScreen();
  });

  it('keeps the compare screen locked too', async () => {
    await renderRouter(appDir, { initialUrl: '/photos/compare?a=p-1&b=p-2' });
    expect(await screen.findByText('Photos are locked')).toBeOnTheScreen();
    expect(screen.queryByText('49 days apart')).toBeNull();
    expect(photosMock.fetchPhotos).not.toHaveBeenCalled();
  });

  it('forgot PIN: resets through a fresh Google sign-in and keeps the photos', async () => {
    const { resetWithGoogle } = jest.requireMock('@/lib/photos/reset');
    await renderRouter(appDir, { initialUrl: '/photos' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Forgot PIN?' }));
    expect(resetWithGoogle).toHaveBeenCalled();
    expect(await screen.findByText('Lock your progress photos')).toBeOnTheScreen();
    expect(photosMock.deletePhoto).not.toHaveBeenCalled();
  });

  it('unlocks with fingerprint when it is turned on (Android)', async () => {
    Object.assign(biometricsState, { supported: true, enabled: true });
    await renderRouter(appDir, { initialUrl: '/photos' });
    expect(await screen.findByRole('button', { name: 'Add photo' })).toBeOnTheScreen();
    expect(photoLockMock.unlockPhotos).toHaveBeenCalledWith({ deviceKey: 'device-key' });
  });

  it('opens without a PIN once the lock is removed', async () => {
    resetPhotoLock('none');
    await renderRouter(appDir, { initialUrl: '/photos' });
    expect(await screen.findByRole('button', { name: 'Add photo' })).toBeOnTheScreen();
  });
});

describe('photo lock settings', () => {
  it('changes the PIN only with the current one', async () => {
    await renderRouter(appDir, { initialUrl: '/photo-lock' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Change PIN or password' }));
    await fireEvent.changeText(screen.getByLabelText('Current PIN'), '1111');
    await fireEvent.changeText(screen.getByLabelText('New PIN (4–6 digits)'), '9876');
    await fireEvent.changeText(screen.getByLabelText('Repeat PIN'), '9876');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Wrong PIN\. 4 attempts left/)).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Current PIN'), '2580');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('PIN changed.')).toBeOnTheScreen();
    expect(photoLockState.secret).toBe('9876');
  });

  it('removes the lock with the current PIN', async () => {
    await renderRouter(appDir, { initialUrl: '/photo-lock' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove photo lock' }));
    await fireEvent.changeText(screen.getByLabelText('Current PIN'), '2580');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove lock' }));
    expect(await screen.findByText('Photo lock removed.')).toBeOnTheScreen();
    expect(screen.getByText('Off')).toBeOnTheScreen();
  });

  it('is reachable from the Profile tab', async () => {
    await renderRouter(appDir, { initialUrl: '/profile' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Photo lock' }));
    await waitFor(() => expect(screen).toHavePathname('/photo-lock'));
    expect(await screen.findByText('PIN')).toBeOnTheScreen();
  });
});
