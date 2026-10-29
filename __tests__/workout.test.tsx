import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { useWorkoutStore } from '@/stores/workoutStore';
import { fakeSession, onboardedProfile, resetBackend, workoutsMock } from '@/test-utils/backend';

jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
jest.mock('@/lib/supabase', () => require('@/test-utils/backend').supabaseMock);
jest.mock('@/lib/api/profiles', () => require('@/test-utils/backend').profilesMock);
jest.mock('@/lib/api/templates', () => require('@/test-utils/backend').templatesMock);
jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);
jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);
jest.mock('@/lib/platform/notifications', () => ({
  supportsLocalNotifications: true,
  ensureNotificationPermission: jest.fn(async () => true),
  scheduleRestNotification: jest.fn(async () => 'notif-1'),
  cancelRestNotification: jest.fn(async () => {}),
}));

const notifications = jest.requireMock('@/lib/platform/notifications');
const appDir = path.resolve(__dirname, '../app');

// confirm() uses Alert on native: press the confirming (last) button.
function autoConfirm() {
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = (args[2] as { onPress?: () => void }[] | undefined) ?? [];
    buttons.at(-1)?.onPress?.();
  });
}

describe('workout logging', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    useWorkoutStore.setState({ workout: null, restTimer: null });
    await AsyncStorage.clear();
    resetBackend({ session: fakeSession(), profile: onboardedProfile() });
    autoConfirm();
  });

  it('starts a workout, logs a set from last time, runs the rest timer and saves', async () => {
    await renderRouter(appDir, { initialUrl: '/workout' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Start empty workout' }));
    await waitFor(() => expect(screen).toHavePathname('/workouts/active'));

    await fireEvent.press(screen.getByRole('button', { name: 'Add exercises' }));
    await waitFor(() => expect(screen).toHavePathname('/exercises/pick'));
    // Hidden exercises aren't offered; recently used ones come first.
    expect(screen.queryByText('Old Hidden Move')).toBeNull();
    expect(await screen.findByText('Recent')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Add 0 exercises' })).toBeDisabled();
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Bench Press (Barbell)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add 1 exercise' }));
    await waitFor(() => expect(screen).toHavePathname('/workouts/active'));

    // Last time + saved rest setting are used.
    expect(await screen.findByText('80 kg × 5')).toBeOnTheScreen();
    expect(screen.getByText('Rest 2:00')).toBeOnTheScreen();

    // Untouched set + done = repeat last time.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    expect(screen.getByLabelText(/^Rest \d+:\d\d left$/)).toBeOnTheScreen();
    expect(notifications.scheduleRestNotification).toHaveBeenCalledWith(
      120,
      'Bench Press (Barbell)',
    );

    // A second set, typed in.
    await fireEvent.press(screen.getByRole('button', { name: '+ Add set' }));
    await fireEvent.changeText(screen.getByLabelText('Set 2 weight (kg)'), '85');
    await fireEvent.changeText(screen.getByLabelText('Set 2 reps'), '3');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Set 2 done' }));

    // The workout is persisted while in progress (survives restart / reload).
    const saved = JSON.parse((await AsyncStorage.getItem('active-workout')) ?? '{}');
    expect(saved.state.workout.exercises[0].sets).toHaveLength(2);

    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(workoutsMock.saveWorkout).toHaveBeenCalled());
    const payload = workoutsMock.saveWorkout.mock.calls[0]![0] as unknown as {
      p_sets: { weight_kg: number; reps: number }[];
    };
    expect(payload.p_sets.map((s) => [s.weight_kg, s.reps])).toEqual([
      [80, 5],
      [85, 3],
    ]);

    await waitFor(() => expect(screen.getByText('Nice work. Saved.')).toBeOnTheScreen());
    expect(useWorkoutStore.getState().workout).toBeNull();
    expect(notifications.cancelRestNotification).toHaveBeenCalled();
  });

  it('won’t mark a set done without reps, and flags it', async () => {
    useWorkoutStore.getState().start('Test', 'kg');
    useWorkoutStore
      .getState()
      .addExercises([require('@/test-utils/backend').exercisesState.list[1]], () => 90);
    await renderRouter(appDir, { initialUrl: '/workouts/active' });
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Set 1 done' }));
    expect(screen.getByRole('checkbox', { name: 'Set 1 done' })).not.toBeChecked();
    expect(screen.queryByLabelText(/^Rest \d+:\d\d left$/)).toBeNull();
  });

  it('discards with confirmation', async () => {
    useWorkoutStore.getState().start('Test', 'kg');
    await renderRouter(appDir, { initialUrl: '/workouts/active' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Discard workout' }));
    await waitFor(() => expect(screen).toHavePathname('/workout'));
    expect(useWorkoutStore.getState().workout).toBeNull();
  });

  it('shows a resume card for a workout restored from storage', async () => {
    useWorkoutStore.getState().start('Leg day', 'kg');
    await renderRouter(appDir, { initialUrl: '/workout' });
    expect(await screen.findByText('Leg day')).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Resume workout' })[0]!);
    await waitFor(() => expect(screen).toHavePathname('/workouts/active'));
    await act(async () => {});
  });
});
