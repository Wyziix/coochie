import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import {
  aiMock,
  aiState,
  fakeSession,
  onboardedProfile,
  resetBackend,
  resetProgress,
  sampleFeedback,
  sampleReport,
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

describe('workout feedback', () => {
  it('asks only when tapped, then shows the feedback', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    expect(await screen.findByText('3 of 3 AI requests left today')).toBeOnTheScreen();
    expect(aiMock.requestWorkoutFeedback).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Get AI feedback' }));
    expect(await screen.findByText(sampleFeedback.summary)).toBeOnTheScreen();
    expect(screen.getByText(sampleFeedback.positives[0]!)).toBeOnTheScreen();
    expect(screen.getByText(sampleFeedback.suggestions[0]!)).toBeOnTheScreen();
    expect(aiMock.requestWorkoutFeedback).toHaveBeenCalledWith('w-1', false);
  });

  it('shows saved feedback without a new request', async () => {
    start();
    aiState.feedback.set('w-1', {
      id: 'fb',
      content: sampleFeedback,
      created_at: '',
      source_updated_at: '2026-10-30T11:00:00Z',
    });
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    expect(await screen.findByText(sampleFeedback.summary)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Get AI feedback' })).toBeNull();
    expect(aiMock.requestWorkoutFeedback).not.toHaveBeenCalled();
  });

  it('the 4th request of the day is blocked with a clear message', async () => {
    start();
    aiState.status = { ...aiState.status, used_today: 3, remaining: 0 };
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    expect(
      await screen.findByText(
        'You’ve used your 3 AI requests for today. You get new ones tomorrow.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Get AI feedback' })).toBeDisabled();
  });

  it('shows the server’s message when it refuses (e.g. limit reached on another device)', async () => {
    start();
    aiState.status = { ...aiState.status, remaining: 1 };
    aiMock.requestWorkoutFeedback.mockRejectedValueOnce(
      new aiMock.AiError(
        'limit',
        "You've used your 3 AI requests for today. You get new ones tomorrow.",
      ),
    );
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Get AI feedback' }));
    expect(
      await screen.findByText(
        "You've used your 3 AI requests for today. You get new ones tomorrow.",
      ),
    ).toBeOnTheScreen();
  });

  it('needs a connection offline', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    await screen.findByRole('button', { name: 'Get AI feedback' });
    await act(async () => onlineManager.setOnline(false));
    expect(await screen.findByText('Needs connection.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Get AI feedback' })).toBeDisabled();
  });

  it('says when AI is switched off or paused for the day', async () => {
    start();
    aiState.status = { ...aiState.status, enabled: false };
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    expect(await screen.findByText('AI features are switched off right now.')).toBeOnTheScreen();
  });

  it('suggests a professional when pain came up', async () => {
    start();
    aiState.feedback.set('w-1', {
      id: 'fb',
      content: {
        ...sampleFeedback,
        see_professional: true,
        warnings: ['You noted shoulder pain.'],
      },
      created_at: '',
      source_updated_at: '2026-10-30T11:00:00Z',
    });
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    expect(await screen.findByText(/see a physiotherapist or doctor/)).toBeOnTheScreen();
  });
});

describe('weekly reports', () => {
  it('shows a "New weekly report" badge on Home until it is opened', async () => {
    start();
    aiState.reports = [
      {
        id: 'rep-1',
        content: sampleReport,
        created_at: '',
        week_start: '2026-10-19',
        seen_at: null,
      },
    ];
    await renderRouter(appDir, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: /^New weekly report/ }));
    expect(await screen.findByText(sampleReport.summary)).toBeOnTheScreen();
    expect(screen.getByText(sampleReport.focus_next_week[0]!)).toBeOnTheScreen();
    expect(screen.getByText(/see a physiotherapist or doctor/)).toBeOnTheScreen();
    await waitFor(() => expect(aiMock.markReportSeen.mock.calls[0]?.[0]).toBe('rep-1'));
    const { router } = require('expo-router');
    await act(() => router.replace('/'));
    await screen.findByText('This week', { exact: true } as never);
    await waitFor(() => expect(screen.queryByText('New weekly report')).toBeNull());
  });

  it('lists reports from the Progress tab', async () => {
    start();
    aiState.reports = [
      {
        id: 'rep-1',
        content: sampleReport,
        created_at: '',
        week_start: '2026-10-19',
        seen_at: null,
      },
    ];
    await renderRouter(appDir, { initialUrl: '/progress' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Weekly reports, new' }));
    expect(await screen.findByText(/Week of/)).toBeOnTheScreen();
  });
});

describe('admin AI', () => {
  it('kill switch, limits and model are changed from the app', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/ai' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Turn AI off (kill switch)' }));
    await waitFor(() => expect(aiMock.updateAiSettings).toHaveBeenCalledWith({ enabled: false }));
    expect(await screen.findByText('AI is off for everyone')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('AI requests per user per day'), '5');
    await fireEvent.changeText(
      screen.getByLabelText('Daily spending cap (USD, everyone together)'),
      '1',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(aiMock.updateAiSettings).toHaveBeenLastCalledWith({
        daily_limit: 5,
        daily_budget_usd: 1,
      }),
    );
  });

  it('sets a per-user override', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/ai' });
    await fireEvent.changeText(await screen.findByLabelText('Find a user (name or email)'), 'anna');
    await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Set 10' }));
    await waitFor(() => expect(aiMock.setAiOverride).toHaveBeenCalledWith('user-2', 10));
    expect(await screen.findByText('Anna: 10 a day')).toBeOnTheScreen();
  });

  it('shows the usage dashboard', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/ai' });
    expect(await screen.findByText('Last 30 days')).toBeOnTheScreen();
    expect(screen.getByText('1 (20%)')).toBeOnTheScreen();
    expect(screen.getByText('5 calls · $0.0013')).toBeOnTheScreen();
  });

  it('"Generate my report now" opens the new report', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/ai' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Generate my report now' }));
    await waitFor(() => expect(screen).toHavePathname('/reports/rep-now'));
  });

  it('is not open to non-admins', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/admin/ai' });
    await waitFor(() => expect(screen).toHavePathname('/'));
  });
});
