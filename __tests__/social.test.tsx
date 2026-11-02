import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import {
  fakeSession,
  onboardedProfile,
  resetBackend,
  resetProgress,
  socialMock,
  socialState,
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

const appDir = path.resolve(__dirname, '../app');

function start(role: 'user' | 'admin' = 'user') {
  resetProgress();
  resetBackend({ session: fakeSession(), profile: onboardedProfile({ role }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    ((args[2] as { onPress?: () => void }[] | undefined) ?? []).at(-1)?.onPress?.();
  });
});

afterEach(() => act(() => onlineManager.setOnline(true)));

describe('feed', () => {
  it('shows friends’ PRs and workouts, with the unread inbox count', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/social' });
    expect(await screen.findByText('New PR on Bench Press (Barbell): 57.5 kg')).toBeOnTheScreen();
    expect(screen.getByText('Finished Push · 52 min, 14 sets')).toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: 'Inbox, 2 new' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Friends, 1 new' })).toBeOnTheScreen();
  });

  it('a PR without the weight when the friend hides it', async () => {
    start();
    socialState.feed[0]!.payload = { exercise: 'Bench Press (Barbell)' };
    await renderRouter(appDir, { initialUrl: '/social' });
    expect(await screen.findByText('New PR on Bench Press (Barbell)')).toBeOnTheScreen();
  });

  it('reacts with 💪 and takes it back', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/social' });
    await fireEvent.press(
      await screen.findByRole('button', {
        name: 'React 💪 on anna: Finished Push · 52 min, 14 sets',
      }),
    );
    await waitFor(() => expect(socialMock.react).toHaveBeenCalledWith('a-2', '💪'));
    await fireEvent.press(
      await screen.findByRole('button', {
        name: 'Remove 💪 on anna: Finished Push · 52 min, 14 sets',
      }),
    );
    await waitFor(() => expect(socialMock.react).toHaveBeenLastCalledWith('a-2', null));
  });

  it('reports a user from a feed item', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/social' });
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Report anna' }))[0]!);
    await fireEvent.press(await screen.findByRole('button', { name: 'Spam' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(socialMock.reportUser).toHaveBeenCalledWith('user-2', 'spam', undefined, 'a-1'),
    );
    expect(await screen.findByText('Thanks. An admin will look at it.')).toBeOnTheScreen();
  });

  it('offline: the saved feed with an "Offline" note; reacting needs a connection', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/social' });
    await screen.findByText('New PR on Bench Press (Barbell): 57.5 kg');
    await act(() => onlineManager.setOnline(false));
    expect(await screen.findByText(/^Offline, last updated/)).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'React 💪 on anna: Finished Push · 52 min, 14 sets' }),
    ).toBeDisabled();
  });
});

describe('friends', () => {
  it('search by partial username, send a request, accept an incoming one', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/friends' });
    await fireEvent.changeText(await screen.findByLabelText('Find friends by username'), 'ann');
    expect(await screen.findByLabelText("annabel's profile")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add anna' }));
    await waitFor(() => expect(socialMock.sendFriendRequest).toHaveBeenCalledWith('user-2'));
    expect(await screen.findByRole('button', { name: 'Cancel anna' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Accept marc' }));
    await waitFor(() =>
      expect(socialMock.respondFriendRequest).toHaveBeenCalledWith('user-4', true),
    );
    expect(await screen.findByText('Friends (1)')).toBeOnTheScreen();
  });

  it('offline: adding friends needs a connection', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/friends' });
    await screen.findByText('Friends (0)');
    await act(() => onlineManager.setOnline(false));
    expect(await screen.findByText('Needs connection to change anything here.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Accept marc' })).toBeDisabled();
  });

  it('a profile: add, block after confirming, report', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/users/anna' });
    expect(await screen.findByText('2 week streak · longest 4')).toBeOnTheScreen();
    expect(screen.getByText('First rep')).toBeOnTheScreen();
    expect(
      screen.getByText('Become friends to see each other’s workouts and PRs.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(socialMock.blockUser).toHaveBeenCalledWith('user-2'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(socialMock.unblockUser).toHaveBeenCalledWith('user-2'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Add friend' }));
    await waitFor(() => expect(socialMock.sendFriendRequest).toHaveBeenCalledWith('user-2'));
  });
});

describe('streaks and badges', () => {
  it('Home shows the current and longest streak', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/' });
    expect(await screen.findByText('3 weeks streak')).toBeOnTheScreen();
    expect(screen.getByText('Longest 5 · 2 more sessions this week')).toBeOnTheScreen();
  });

  it('badge collection: earned with the date, locked with progress', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/badges' });
    expect(
      await screen.findByText(
        '1 of 3 earned. Strength badges compare with your bodyweight, so they’re fair for everyone.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(/^Earned .*2026/)).toBeOnTheScreen();
    expect(screen.getByText('7 / 10')).toBeOnTheScreen();
    expect(screen.getByText('70 / 80')).toBeOnTheScreen();
    expect(screen.getByLabelText('Regular, locked')).toBeOnTheScreen();
  });
});

describe('challenges', () => {
  it('accept an invite, join a global one', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/challenges' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Accept Squat week' }));
    await waitFor(() =>
      expect(socialMock.setChallengeStatus).toHaveBeenCalledWith('ch-3', 'joined'),
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Join November workouts' }));
    await waitFor(() =>
      expect(socialMock.setChallengeStatus).toHaveBeenCalledWith('ch-2', 'joined'),
    );
  });

  it('detail: my progress toward the goal and the live ranking', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/challenges/ch-1' });
    expect(await screen.findByText('You: 2 workouts')).toBeOnTheScreen();
    expect(screen.getByText('Goal: 4')).toBeOnTheScreen();
    expect(screen.getByText('Level 4 · 3 workouts')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Your progress' })).toHaveProp(
      'aria-valuenow',
      50,
    );
  });

  it('final results show the winner', async () => {
    start();
    socialState.challenges[0] = {
      ...socialState.challenges[0]!,
      state: 'finished',
      ranking: (socialState.challenges[0]!.ranking as { winner: boolean; rank: number }[]).map(
        (r) => ({ ...r, winner: r.rank === 1 }),
      ),
    };
    await renderRouter(appDir, { initialUrl: '/challenges/ch-1' });
    expect(await screen.findByText('anna won')).toBeOnTheScreen();
    expect(screen.getByText('Final results')).toBeOnTheScreen();
  });

  it('creates a friend challenge', async () => {
    start();
    socialState.friends.friends = [
      { user_id: 'user-2', username: 'anna', avatar_url: null, level: 4 },
    ];
    await renderRouter(appDir, { initialUrl: '/challenges/new' });
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Sets week');
    await fireEvent.press(screen.getByRole('radio', { name: 'Sets' }));
    await fireEvent.changeText(screen.getByLabelText('Goal (optional)'), '60');
    await fireEvent.press(screen.getByRole('button', { name: 'anna' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create challenge' }));
    await waitFor(() =>
      expect(socialMock.createFriendChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Sets week',
          metric: 'sets',
          goal: 60,
          exercise_id: null,
        }),
        ['user-2'],
      ),
    );
    await waitFor(() => expect(screen).toHavePathname('/challenges/ch-new'));
  });
});

describe('inbox and settings', () => {
  it('lists notifications, opens one, marks all read', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/notifications' });
    expect(await screen.findByText('2 new')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(socialMock.markNotificationsRead).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText('All caught up')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText(/Challenge invite\. anna invited you/));
    await waitFor(() => expect(screen).toHavePathname('/challenges/ch-3'));
  });

  it('privacy and notification switches are saved', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/social-settings' });
    await fireEvent(
      await screen.findByLabelText('Show the weight on my PRs'),
      'valueChange',
      false,
    );
    await waitFor(() =>
      expect(socialMock.savePrivacySettings).toHaveBeenCalledWith(expect.any(String), {
        activity_visibility: 'friends',
        pr_show_weight: false,
      }),
    );
    await fireEvent.press(screen.getByRole('radio', { name: /Nobody/ }));
    await waitFor(() =>
      expect(socialMock.savePrivacySettings).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ activity_visibility: 'nobody' }),
      ),
    );
    await fireEvent(screen.getByLabelText('Streak at risk (Sunday evening)'), 'valueChange', false);
    await waitFor(() =>
      expect(socialMock.saveNotificationSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ streak_risk: false, friend_request: true }),
      ),
    );
  });
});

describe('friends leaderboard', () => {
  it('in the Ranking tab', async () => {
    start();
    socialState.friends.friends = [
      { user_id: 'user-2', username: 'anna', avatar_url: null, level: 4 },
    ];
    await renderRouter(appDir, { initialUrl: '/ranking' });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Friends' }));
    expect(await screen.findByLabelText('Rank 1, anna, level 4, 400 points')).toBeOnTheScreen();
    expect(socialMock.fetchFriendsLeaderboard).toHaveBeenCalledWith('week');
  });

  it('no friends yet: says how to add them', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/ranking' });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Friends' }));
    expect(await screen.findByText('No friends yet')).toBeOnTheScreen();
  });
});

describe('admin', () => {
  it('creates a badge with a relative strength rule', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/badges' });
    await fireEvent.press(await screen.findByRole('button', { name: 'New badge' }));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Squat 1× BW');
    await fireEvent.changeText(screen.getByLabelText('Description'), 'Squat your bodyweight.');
    await fireEvent.press(screen.getByRole('radio', { name: 'Lift × BW' }));
    await fireEvent.changeText(screen.getByLabelText('Times bodyweight (e.g. 1.5)'), '1');
    await fireEvent.changeText(screen.getByLabelText('Exercise'), 'squat');
    await fireEvent.press(await screen.findByRole('button', { name: 'Squat (Barbell)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save badge' }));
    await waitFor(() =>
      expect(socialMock.saveBadge).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          name: 'Squat 1× BW',
          rule_type: 'pr_bodyweight',
          rule: { exercise_id: 'ex-squat', ratio: 1 },
        }),
      ),
    );
  });

  it('reports: ban after confirming', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/reports' });
    expect(await screen.findByText('“Keeps sending requests”')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Ban spammy' }));
    await waitFor(() =>
      expect(socialMock.resolveReport).toHaveBeenCalledWith('r-1', 'ban', undefined),
    );
    expect(await screen.findByText('No open reports')).toBeOnTheScreen();
  });

  it('global challenge: create with a points reward', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/challenges' });
    await fireEvent.press(await screen.findByRole('button', { name: 'New global challenge' }));
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Most workouts in December');
    await fireEvent.changeText(screen.getByLabelText('Start'), '2026-12-01');
    await fireEvent.changeText(screen.getByLabelText('End'), '2026-12-31');
    await fireEvent.press(screen.getByRole('button', { name: 'Save challenge' }));
    await waitFor(() =>
      expect(socialMock.saveChallenge).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          title: 'Most workouts in December',
          metric: 'workouts',
          start_date: '2026-12-01',
          end_date: '2026-12-31',
          reward_points: 100,
        }),
      ),
    );
  });
});
