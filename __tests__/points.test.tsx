import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { useWorkoutStore } from '@/stores/workoutStore';
import {
  exercisesState,
  fakeSession,
  onboardedProfile,
  pointsMock,
  pointsState,
  profilesMock,
  resetBackend,
  resetProgress,
  sampleBoard,
  sampleWorkoutPoints,
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
jest.mock('@/lib/platform/notifications', () => ({
  ensureNotificationPermission: jest.fn(async () => true),
  scheduleRestNotification: jest.fn(async () => null),
  cancelRestNotification: jest.fn(async () => {}),
}));

const appDir = path.resolve(__dirname, '../app');

function start(role: 'user' | 'admin' = 'user') {
  resetProgress();
  useWorkoutStore.setState({ workout: null, restTimer: null });
  resetBackend({ session: fakeSession(), profile: onboardedProfile({ role }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    ((args[2] as { onPress?: () => void }[] | undefined) ?? []).at(-1)?.onPress?.();
  });
});

const defaultWorkoutPoints = pointsMock.fetchWorkoutPoints.getMockImplementation()!;
afterEach(async () => {
  pointsMock.fetchWorkoutPoints.mockImplementation(defaultWorkoutPoints);
  await act(() => onlineManager.setOnline(true));
});

describe('Ranking tab', () => {
  it('shows the weekly board with my rank, then month and all-time', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/ranking' });
    expect(await screen.findByLabelText('Rank 1, anna, level 4, 420 points')).toBeOnTheScreen();
    expect(screen.getByLabelText('Rank 2, gleb (you), level 3, 310 points')).toBeOnTheScreen();
    expect(screen.getByText('#2 · 310 points')).toBeOnTheScreen();
    expect(
      screen.getByText('The weekly board resets every Monday at 00:00, Madrid time.'),
    ).toBeOnTheScreen();
    expect(pointsMock.fetchLeaderboard).toHaveBeenCalledWith('week');
    await fireEvent.press(screen.getByRole('radio', { name: 'All time' }));
    await waitFor(() => expect(pointsMock.fetchLeaderboard).toHaveBeenCalledWith('all'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Month' }));
    await waitFor(() => expect(pointsMock.fetchLeaderboard).toHaveBeenCalledWith('month'));
    expect(screen.getByText('Friends')).toBeOnTheScreen();
  });

  it('always shows my rank, even outside the top', async () => {
    start();
    pointsState.boards.week = {
      ...sampleBoard(),
      entries: sampleBoard().entries.filter((e) => !e.is_me),
      me: { ...sampleBoard().me, rank: 12, points: 40 },
    };
    await renderRouter(appDir, { initialUrl: '/ranking' });
    expect(await screen.findByText('#12 · 40 points')).toBeOnTheScreen();
    expect(screen.getByText('You’re #12, outside the top 1.')).toBeOnTheScreen();
  });

  it('hidden: says so and shows the rank I would have; removed by an admin: no rank', async () => {
    start();
    pointsState.boards.week = { ...sampleBoard(), me: { ...sampleBoard().me, hidden: true } };
    await renderRouter(appDir, { initialUrl: '/ranking' });
    expect(
      await screen.findByText(/You’re hidden from public leaderboards.*you’d be #2/),
    ).toBeOnTheScreen();

    pointsState.boards.week = {
      ...sampleBoard(),
      me: { ...sampleBoard().me, rank: null, removed: true },
    };
    await renderRouter(appDir, { initialUrl: '/ranking' });
    expect(await screen.findByText(/You’re not shown on public leaderboards/)).toBeOnTheScreen();
  });

  it('offline: the last cached board with "Offline, last updated"', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/ranking' });
    await screen.findByLabelText('Rank 1, anna, level 4, 420 points');
    await act(() => onlineManager.setOnline(false));
    expect(
      await screen.findByText(/^Offline, last updated (just now|\d+ min ago)\.$/),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Rank 1, anna, level 4, 420 points')).toBeOnTheScreen();
  });
});

describe('levels', () => {
  it('Home and Profile show the level and the bar to the next one', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/' });
    expect(await screen.findByText('Level 1')).toBeOnTheScreen();
    expect(screen.getByText('Rookie I')).toBeOnTheScreen();
    expect(screen.getByText('36 points to level 2 · 64 this week')).toBeOnTheScreen();
    await renderRouter(appDir, { initialUrl: '/profile' });
    expect(await screen.findByText('Level 1')).toBeOnTheScreen();
  });

  it('the points history explains every point', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/points' });
    expect(await screen.findByText('Workout done')).toBeOnTheScreen();
    expect(screen.getByText('Working sets (4)')).toBeOnTheScreen();
    expect(
      await screen.findByText(/A workout with at least 3 working sets: 50 points/),
    ).toBeOnTheScreen();
  });

  it('a level up after a workout gets its own moment, with the points', async () => {
    start();
    // Every workout id gets a level up; restored in afterEach.
    pointsMock.fetchWorkoutPoints.mockImplementation(async () => sampleWorkoutPoints());
    await renderRouter(appDir, { initialUrl: '/workout' });
    await screen.findByRole('button', { name: 'Start empty workout' });
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
    expect(await screen.findByText('Level up!')).toBeOnTheScreen();
    expect(screen.getByText('Level 2 · Rookie II')).toBeOnTheScreen();
    expect(screen.getByText('+69 points')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Progress to level 3' })).toHaveProp(
      'aria-valuenow',
      4,
    );
  });
});

describe('workout points', () => {
  it('shows the points and why', async () => {
    start();
    pointsState.workouts.set('w-1', sampleWorkoutPoints());
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    expect(await screen.findByText('+69 points')).toBeOnTheScreen();
    expect(screen.getByText('Personal records: Bench Press (Barbell)')).toBeOnTheScreen();
  });

  it('a flagged workout says "Under review", never why', async () => {
    start();
    pointsState.workouts.set(
      'w-1',
      sampleWorkoutPoints({ review: 'pending', points: 0, items: [] }),
    );
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    expect(await screen.findByText('Under review')).toBeOnTheScreen();
    expect(screen.queryByText(/unrealistic|suspicious|cheat/i)).toBeNull();
  });

  it('rejected: no points, neutral wording', async () => {
    start();
    pointsState.workouts.set(
      'w-1',
      sampleWorkoutPoints({ review: 'rejected', points: 0, items: [] }),
    );
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    expect(await screen.findByText('No points for this workout')).toBeOnTheScreen();
  });
});

describe('profile privacy', () => {
  it('"Hide me from public leaderboards" saves to the profile', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/profile' });
    await fireEvent(
      await screen.findByLabelText('Hide me from public leaderboards'),
      'valueChange',
      true,
    );
    await waitFor(() =>
      expect(profilesMock.saveProfile).toHaveBeenCalledWith(expect.any(String), {
        leaderboard_hidden: true,
      }),
    );
  });
});

describe('admin', () => {
  it('flagged workouts: reasons and sets, then approve or reject', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/flagged' });
    expect(
      await screen.findByText(/Bicep Curl: 500 kg is above the believable 66 kg/),
    ).toBeOnTheScreen();
    expect(screen.getByText('Bicep Curl: 500 kg × 8')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Approve Arms by anna' }));
    await waitFor(() => expect(pointsMock.reviewWorkout).toHaveBeenCalledWith('w-flag', true));
    expect(await screen.findByText('Nothing to review')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Approved' }));
    expect(await screen.findByText('Approved: points granted')).toBeOnTheScreen();
  });

  it('users: ban from leaderboards (after confirming) and see why they have their points', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/users' });
    await fireEvent(
      await screen.findByLabelText('Banned from leaderboards: anna'),
      'valueChange',
      true,
    );
    await waitFor(() =>
      expect(pointsMock.setUserModeration).toHaveBeenCalledWith('user-2', {
        leaderboard_banned: true,
        hidden: false,
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Why these points?' }));
    expect(await screen.findByText('2026-11-01 · Workout done · Push')).toBeOnTheScreen();
  });

  it('points settings are edited in the app', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/points' });
    await fireEvent.changeText(await screen.findByLabelText('Points per workout'), '60');
    await fireEvent.changeText(screen.getByLabelText('Weekly goal points'), '120');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(pointsMock.updatePointsSettings).toHaveBeenCalledWith({
        workout_points: 60,
        weekly_goal_points: 120,
      }),
    );
    expect(await screen.findByText('Saved. Points recalculated.')).toBeOnTheScreen();
  });
});
