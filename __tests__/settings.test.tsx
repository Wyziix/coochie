import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { onlineManager } from '@tanstack/react-query';
import path from 'path';

import * as push from '@/lib/platform/push';
import { useOutboxStore } from '@/lib/offline/outbox';
import { useWorkoutStore } from '@/stores/workoutStore';
import {
  backend,
  fakeSession,
  onboardedProfile,
  profilesMock,
  resetBackend,
  socialMock,
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

/** A JWT whose session signed in `minutesAgo` minutes ago (amr). */
function jwt(minutesAgo: number) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const timestamp = Math.floor(Date.now() / 1000) - minutesAgo * 60;
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', amr: [{ method: 'oauth', timestamp }] })}.sig`;
}

function start(signedInMinutesAgo = 60) {
  useWorkoutStore.setState({ workout: null, restTimer: null });
  const session = { ...fakeSession(), access_token: jwt(signedInMinutesAgo) };
  session.user = { ...session.user, email: 'gleb@example.com' };
  resetBackend({ session, profile: onboardedProfile() });
}

const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    ((args[2] as { onPress?: () => void }[] | undefined) ?? []).at(-1)?.onPress?.();
  });
});
afterEach(async () => {
  await act(() => onlineManager.setOnline(true));
});

describe('Settings', () => {
  it('has everything in one place and is reachable from Profile', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/profile' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(screen).toHavePathname('/settings'));
    for (const heading of [
      'Units',
      'Appearance',
      'Default rest time',
      'Notifications',
      'Who sees my activity',
      'Leaderboards',
      'Photo lock',
      'Nutrition targets',
      'Your data',
      'Delete account',
    ]) {
      expect(await screen.findAllByText(heading)).not.toHaveLength(0);
    }
  });

  it('push asks for permission only after the tap', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/settings' });
    const button = await screen.findByRole('button', { name: 'Turn on push notifications' });
    expect(push.pushState).toHaveBeenCalled();
    expect(push.enablePush).not.toHaveBeenCalled();
    await fireEvent.press(button);
    await waitFor(() => expect(push.enablePush).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Push notifications are on for this device.')).toBeOnTheScreen();
  });

  it('notification types, the weekly report and the rest timer can be turned off', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/settings' });
    await fireEvent(await screen.findByLabelText('Weekly report is ready'), 'valueChange', false);
    await waitFor(() =>
      expect(socialMock.saveNotificationSettings).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ weekly_report: false, rest_timer: true }),
      ),
    );
  });

  it('default rest time and units save to the profile', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/settings' });
    await fireEvent.press(await screen.findByRole('radio', { name: '2:30' }));
    await waitFor(() =>
      expect(profilesMock.saveProfile).toHaveBeenCalledWith(expect.any(String), {
        default_rest_seconds: 150,
      }),
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'lbs / in' }));
    await waitFor(() =>
      expect(profilesMock.saveProfile).toHaveBeenLastCalledWith(expect.any(String), {
        units: 'lbs',
      }),
    );
  });

  it('export: built on the server, then saved with a second tap', async () => {
    start();
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['zip']), {
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="lightweightbaby-export-2026-11-02.zip"',
        },
      }),
    );
    await renderRouter(appDir, { initialUrl: '/settings' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Export my data' }));
    expect(
      await screen.findByText(/Your export is ready: lightweightbaby-export-2026-11-02.zip/),
    ).toBeOnTheScreen();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://test.supabase.co/functions/v1/export-data');
    expect(init.headers['x-photo-unlock']).toBeUndefined();
    await fireEvent.press(screen.getByRole('button', { name: 'Save file' }));
    // The native build can't save files; the web app can (saveFile.web.ts).
    expect(await screen.findByText('Exports can be saved from the web app.')).toBeOnTheScreen();
  });

  it('export: the server’s message is shown (rate limit)', async () => {
    start();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'rate_limited',
          message: 'You exported several times already. Try again in an hour.',
        }),
        {
          status: 429,
        },
      ),
    );
    await renderRouter(appDir, { initialUrl: '/settings' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Export my data' }));
    expect(
      await screen.findByText('You exported several times already. Try again in an hour.'),
    ).toBeOnTheScreen();
  });
});

describe('Delete account', () => {
  it('needs a recent sign-in and the exact username', async () => {
    start(60);
    await renderRouter(appDir, { initialUrl: '/delete-account' });
    expect(
      await screen.findByRole('button', { name: 'Sign in again with Google' }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Email me a code instead' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Username to confirm'), 'gleb');
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
  });

  it('deletes on the server, clears this device and signs out', async () => {
    start(2);
    useWorkoutStore.getState().start('Leftover', 'kg');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ deleted: true }), { status: 200 }),
    );
    await renderRouter(appDir, { initialUrl: '/delete-account' });
    expect(await screen.findByText('Signed in 2 min ago. ✓')).toBeOnTheScreen();
    const button = screen.getByRole('button', { name: 'Delete my account' });
    expect(button).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Username to confirm'), ' Gleb ');
    await fireEvent.press(button);
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://test.supabase.co/functions/v1/delete-account');
    expect(JSON.parse(init.body)).toEqual({ username: ' Gleb ' });
    expect(push.unregisterPush).toHaveBeenCalled();
    expect(useWorkoutStore.getState().workout).toBeNull();
    expect(useOutboxStore.getState().items).toEqual([]);
    expect(backend.session).toBeNull();
  });

  it('shows why the server refused (last admin)', async () => {
    start(1);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'last_admin',
          message: 'You are the last admin. Make someone else an admin first.',
        }),
        {
          status: 409,
        },
      ),
    );
    await renderRouter(appDir, { initialUrl: '/delete-account' });
    await fireEvent.changeText(await screen.findByLabelText('Username to confirm'), 'gleb');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(
      await screen.findByText('You are the last admin. Make someone else an admin first.'),
    ).toBeOnTheScreen();
    expect(backend.session).not.toBeNull();
  });
});
