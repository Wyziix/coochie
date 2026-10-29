import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { useOutboxStore } from '@/lib/offline/outbox';
import { useWorkoutStore } from '@/stores/workoutStore';
import {
  exercisesState,
  fakeSession,
  onboardedProfile,
  resetBackend,
  resetProgress,
  workoutsMock,
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
jest.mock('@/lib/api/photoLock', () => ({
  ...jest.requireActual('@/lib/api/photoLock'),
  ...require('@/test-utils/backend').photoLockMock,
}));
jest.mock('@/lib/photos/biometrics', () => require('@/test-utils/backend').biometricsMock);
jest.mock('@/lib/platform/notifications', () => ({
  ensureNotificationPermission: jest.fn(async () => true),
  scheduleRestNotification: jest.fn(async () => null),
  cancelRestNotification: jest.fn(async () => {}),
}));

const appDir = path.resolve(__dirname, '../app');
let alerts: { title: string; message?: string }[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  resetProgress();
  useWorkoutStore.setState({ workout: null, restTimer: null });
  resetBackend({ session: fakeSession(), profile: onboardedProfile({ role: 'admin' }) });
  alerts = [];
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    alerts.push({ title: args[0] as string, message: args[1] as string | undefined });
    ((args[2] as { onPress?: () => void }[] | undefined) ?? []).at(-1)?.onPress?.();
  });
});

afterEach(() => act(() => onlineManager.setOnline(true)));

/** Opens the app online (like at home), optionally loses the connection, then logs a workout. */
async function finishOneSet({ offline = false } = {}) {
  await renderRouter(appDir, { initialUrl: '/workout' });
  await screen.findByRole('button', { name: 'Start empty workout' });
  if (offline) await act(async () => onlineManager.setOnline(false));
  await act(async () => {
    useWorkoutStore.getState().start('Gym', 'kg');
    useWorkoutStore.getState().addExercises([exercisesState.list[0]!], () => 90);
  });
  const { router } = require('expo-router');
  await act(() => router.push('/workouts/active'));
  await fireEvent.changeText(await screen.findByLabelText('Set 1 weight (kg)'), '100');
  await fireEvent.changeText(screen.getByLabelText('Set 1 reps'), '5');
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Set 1 done' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
}

describe('offline', () => {
  it('finishes a workout offline, shows it waiting, and syncs it once when back online', async () => {
    await finishOneSet({ offline: true });
    expect(await screen.findByText('Nice work. Saved on this device.')).toBeOnTheScreen();
    expect(screen.getByText(/Waiting to sync/)).toBeOnTheScreen();
    expect(workoutsMock.saveWorkout).not.toHaveBeenCalled();
    expect(useWorkoutStore.getState().workout).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(
      await screen.findByRole('button', { name: /Offline, 1 change waiting to sync/ }),
    ).toBeOnTheScreen();

    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(useOutboxStore.getState().items).toEqual([]));
    expect(workoutsMock.saveWorkout).toHaveBeenCalledTimes(1);
    expect(workoutsMock.saveWorkout.mock.calls[0]![0].p_workout).toMatchObject({
      name: 'Gym',
      client_updated_at: expect.any(String),
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /waiting to sync/ })).toBeNull(),
    );
  });

  it('shows a change the server refused and lets me discard it', async () => {
    workoutsMock.saveWorkout.mockRejectedValueOnce(
      Object.assign(new Error('exercise ex-bench not available'), { code: '23503' }),
    );
    await finishOneSet();
    expect(
      await screen.findByText('Couldn’t sync this workout. Tap to see why.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Couldn’t sync this workout. Tap to see why.'));
    expect(await screen.findByText('Couldn’t sync')).toBeOnTheScreen();
    expect(screen.getByText(/exercise ex-bench not available/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(useOutboxStore.getState().items).toEqual([]));
    expect(await screen.findByText('All synced')).toBeOnTheScreen();
  });

  it('warns before logging out with unsynced changes', async () => {
    await finishOneSet({ offline: true });
    await screen.findByText('Nice work. Saved on this device.');
    const { router } = require('expo-router');
    await act(() => router.replace('/profile'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Log out' }));
    const alert = alerts.find((a) => a.title === 'Log out with unsynced changes?');
    expect(alert?.message).toMatch(/1 change hasn’t synced yet/);
    expect(alert?.message).toMatch(/never to another one/);
    expect(alert?.message).toMatch(/You’re offline/);
  });

  it('says photos and admin tools need a connection', async () => {
    await renderRouter(appDir, { initialUrl: '/workout' });
    await screen.findByRole('button', { name: 'Start empty workout' });
    await act(async () => onlineManager.setOnline(false));
    const { router } = require('expo-router');
    await act(() => router.push('/photos'));
    expect(await screen.findByText('Needs connection')).toBeOnTheScreen();
    await act(() => router.replace('/admin'));
    expect(await screen.findByText(/Admin tools change data for everyone/)).toBeOnTheScreen();
  });

  it('never finishes another account’s workout in progress', async () => {
    useWorkoutStore.setState({
      workout: {
        id: 'w-x',
        name: 'Not mine',
        startedAt: new Date().toISOString(),
        units: 'kg',
        exercises: [],
        ownerId: 'someone-else',
      },
      restTimer: null,
    });
    await renderRouter(appDir, { initialUrl: '/workout' });
    await screen.findByRole('button', { name: 'Start empty workout' });
    expect(useWorkoutStore.getState().workout).toBeNull();
  });
});
