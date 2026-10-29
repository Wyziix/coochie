import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { useWorkoutStore } from '@/stores/workoutStore';
import {
  bodyMock,
  exercisesState,
  fakeSession,
  onboardedProfile,
  photosMock,
  progressState,
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
jest.mock('@/lib/images/compress', () => ({
  compressPhoto: jest.fn(async () => ({ uri: 'file:///small.jpg', width: 1200, height: 1600 })),
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///big.jpg', width: 3000, height: 4000 }],
  })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('@/lib/platform/notifications', () => ({
  ensureNotificationPermission: jest.fn(async () => true),
  scheduleRestNotification: jest.fn(async () => null),
  cancelRestNotification: jest.fn(async () => {}),
}));

const appDir = path.resolve(__dirname, '../app');

function autoConfirm() {
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    ((args[2] as { onPress?: () => void }[] | undefined) ?? []).at(-1)?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetProgress();
  useWorkoutStore.setState({ workout: null, restTimer: null });
  resetBackend({ session: fakeSession(), profile: onboardedProfile() });
  autoConfirm();
});

async function finishOneSet() {
  useWorkoutStore.getState().start('Push', 'kg');
  useWorkoutStore.getState().addExercises([exercisesState.list[0]!], () => 90);
  await renderRouter(appDir, { initialUrl: '/workouts/active' });
  await fireEvent.changeText(await screen.findByLabelText('Set 1 weight (kg)'), '100');
  await fireEvent.changeText(screen.getByLabelText('Set 1 reps'), '3');
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Set 1 done' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
  await waitFor(() => expect(workoutsMock.saveWorkout).toHaveBeenCalled());
}

describe('PR celebration', () => {
  it('celebrates the records the server reports, then shows the summary', async () => {
    progressState.newRecords = [
      {
        exercise_id: 'ex-bench',
        exercise_name: 'Bench Press (Barbell)',
        exercise_type: 'weights',
        record_type: 'heaviest_weight',
        value: 100,
        previous_value: 95,
        weight_kg: 100,
        reps: 3,
      },
      {
        exercise_id: 'ex-bench',
        exercise_name: 'Bench Press (Barbell)',
        exercise_type: 'weights',
        record_type: 'best_e1rm',
        value: 110,
        previous_value: 105,
        weight_kg: 100,
        reps: 3,
      },
    ];
    await finishOneSet();
    await waitFor(() => expect(screen).toHavePathname('/workouts/celebrate'));
    expect(screen.getByText('2 new personal records!')).toBeOnTheScreen();
    expect(screen.getByText('was 95 kg')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Nice work. Saved.')).toBeOnTheScreen());
    expect(await screen.findByText('2 personal records')).toBeOnTheScreen();
  });

  it('goes straight to the summary when the server reports no records', async () => {
    await finishOneSet();
    await waitFor(() => expect(screen.getByText('Nice work. Saved.')).toBeOnTheScreen());
    expect(screen.queryByText(/new personal record/)).toBeNull();
  });
});

describe('body stats', () => {
  it('logs bodyweight in the user’s unit; the server keeps the profile in sync', async () => {
    resetBackend({ session: fakeSession(), profile: onboardedProfile({ units: 'lbs' }) });
    await renderRouter(appDir, { initialUrl: '/body' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Log measurements' }));
    await fireEvent.changeText(screen.getByLabelText('Bodyweight (lbs)'), '176');
    await fireEvent.changeText(screen.getByLabelText('Waist (in)'), '32');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(bodyMock.saveMeasurement).toHaveBeenCalledWith(
        expect.objectContaining({ bodyweight_kg: 79.83, waist_cm: 81.3 }),
        expect.anything(),
      ),
    );
  });

  it('rejects an empty entry', async () => {
    await renderRouter(appDir, { initialUrl: '/body' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Log measurements' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter at least one value')).toBeOnTheScreen();
    expect(bodyMock.saveMeasurement).not.toHaveBeenCalled();
  });
});

async function unlockPhotos() {
  await fireEvent.changeText(await screen.findByLabelText('PIN'), '2580');
  await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
}

describe('progress photos', () => {
  it('picks, compresses and uploads a photo', async () => {
    await renderRouter(appDir, { initialUrl: '/photos' });
    await unlockPhotos();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add photo' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Side' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));
    await waitFor(() => expect(photosMock.uploadPhoto).toHaveBeenCalled());
    const { compressPhoto } = jest.requireMock('@/lib/images/compress');
    expect(compressPhoto).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///big.jpg' }));
    expect(photosMock.uploadPhoto).toHaveBeenCalledWith(
      'tok-1',
      { uri: 'file:///small.jpg', width: 1200, height: 1600 },
      expect.objectContaining({ pose: 'side' }),
    );
  });

  it('compares two photos', async () => {
    await renderRouter(appDir, { initialUrl: '/photos' });
    await unlockPhotos();
    await fireEvent.press(await screen.findByRole('button', { name: 'Compare' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'front photo, 2026-10-20' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'front photo, 2026-09-01' }));
    await waitFor(() => expect(screen).toHavePathname('/photos/compare'));
    expect(screen.getByText('49 days apart')).toBeOnTheScreen();
  });
});

describe('exercise progress and overview', () => {
  it('shows records and a chart for an exercise', async () => {
    await renderRouter(appDir, { initialUrl: '/exercises/ex-bench?tab=progress' });
    expect(await screen.findByText('Heaviest weight')).toBeOnTheScreen();
    expect(screen.getAllByText('100 kg').length).toBeGreaterThan(0);
    expect(screen.getByText('Most reps by weight')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Est. 1RM' }));
    // Chart summary shows the latest e1RM (the record card shows it too).
    await waitFor(() => expect(screen.getAllByText('116.7 kg')).toHaveLength(2));

    // Tapping the chart selects the nearest session.
    await fireEvent(screen.getByTestId('chart-area'), 'layout', {
      nativeEvent: { layout: { width: 358 } },
    });
    expect(screen.getByText(/^Latest · /)).toBeOnTheScreen();
    await fireEvent(await screen.findByTestId('chart-scrub'), 'responderGrant', {
      nativeEvent: { locationX: 9 },
    });
    await waitFor(() => expect(screen.queryByText(/^Latest · /)).toBeNull());
    expect(screen.getAllByText('116.7 kg')).toHaveLength(1);
  });

  it('shows the weekly overview on Home', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    expect(await screen.findByText('This week')).toBeOnTheScreen();
    expect(await screen.findByText('1 / 4')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Triceps 4.5' })).toBeOnTheScreen();
  });

  it('lists body, photos, records and exercises on the Progress tab', async () => {
    await renderRouter(appDir, { initialUrl: '/progress' });
    expect(await screen.findByText('81 kg')).toBeOnTheScreen();
    expect(await screen.findByText('Locked · 2 photos')).toBeOnTheScreen();
    expect(screen.getByText('was 95 kg')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Bench Press (Barbell) progress' }));
    await waitFor(() => expect(screen).toHavePathname('/exercises/ex-bench'));
  });
});
