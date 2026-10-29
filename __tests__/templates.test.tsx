import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'path';

import { useTemplateDraftStore } from '@/stores/templateDraftStore';
import { useWorkoutStore } from '@/stores/workoutStore';
import {
  fakeSession,
  onboardedProfile,
  resetBackend,
  resetTemplates,
  templatesMock,
  workoutsMock,
} from '@/test-utils/backend';

jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
jest.mock('@/lib/supabase', () => require('@/test-utils/backend').supabaseMock);
jest.mock('@/lib/api/profiles', () => require('@/test-utils/backend').profilesMock);
jest.mock('@/lib/api/progress', () => require('@/test-utils/backend').progressMock);
jest.mock('@/lib/api/body', () => require('@/test-utils/backend').bodyMock);
jest.mock('@/lib/api/photos', () => require('@/test-utils/backend').photosMock);
jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);
jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);
jest.mock('@/lib/api/templates', () => require('@/test-utils/backend').templatesMock);
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
  resetTemplates();
  useWorkoutStore.setState({ workout: null, restTimer: null });
  useTemplateDraftStore.setState({ draft: null });
  resetBackend({ session: fakeSession(), profile: onboardedProfile() });
  autoConfirm();
});

describe('templates', () => {
  it('starts a workout from a ready-made template in one tap', async () => {
    await renderRouter(appDir, { initialUrl: '/workout' });
    expect(await screen.findByText('Push Pull Legs')).toBeOnTheScreen();
    expect(screen.getByText('My Legs')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Start Push' }));
    await waitFor(() => expect(screen).toHavePathname('/workouts/active'));
    const w = useWorkoutStore.getState().workout!;
    expect(w).toMatchObject({ name: 'Push', templateId: 'tpl-push' });
    expect(w.exercises[0]!.sets).toHaveLength(4);
    expect(screen.getByText(/Target 4 × 8–12/)).toBeOnTheScreen();
  });

  it('asks before replacing a workout in progress', async () => {
    useWorkoutStore.getState().start('Old one', 'kg');
    await renderRouter(appDir, { initialUrl: '/workout' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Start My Legs' }));
    const { Alert } = require('react-native');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Discard “Old one”?',
      expect.any(String),
      expect.any(Array),
    );
    await waitFor(() => expect(useWorkoutStore.getState().workout?.name).toBe('My Legs'));
  });

  it('builds a new template with the multi-select picker', async () => {
    await renderRouter(appDir, { initialUrl: '/workout' });
    await fireEvent.press(await screen.findByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen).toHavePathname('/templates/edit'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Arms');

    await fireEvent.press(screen.getByRole('button', { name: 'Add exercises' }));
    await waitFor(() => expect(screen).toHavePathname('/exercises/pick'));
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Bench Press (Barbell)' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Plank' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add 2 exercises' }));
    await waitFor(() => expect(screen).toHavePathname('/templates/edit'));

    expect(screen.getByText('1. Bench Press (Barbell)')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'More sets of Bench Press (Barbell)' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Move Plank up' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => expect(templatesMock.saveTemplate).toHaveBeenCalled());
    const [id, payload] = templatesMock.saveTemplate.mock.calls[0]! as unknown as [
      null,
      { p_template: { name: string }; p_exercises: { exercise_id: string; target_sets: number }[] },
    ];
    expect(id).toBeNull();
    expect(payload.p_template.name).toBe('Arms');
    expect(payload.p_exercises.map((e) => [e.exercise_id, e.target_sets])).toEqual([
      ['ex-plank', 3],
      ['ex-bench', 4],
    ]);
  });

  it('copies a ready-made template into your own', async () => {
    await renderRouter(appDir, { initialUrl: '/templates/tpl-push' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Copy to my templates' }));
    await waitFor(() => expect(screen).toHavePathname('/templates/edit'));
    expect(screen.getByDisplayValue('Push (copy)')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(templatesMock.saveTemplate).toHaveBeenCalledWith(null, expect.anything()),
    );
  });
});

describe('past workouts', () => {
  it('edits a past workout and saves it through the server', async () => {
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit workout' }));
    await waitFor(() => expect(screen).toHavePathname('/workouts/edit'));

    expect(screen.getByLabelText('Set 1 weight (kg)').props.value).toBe('80');
    await fireEvent.changeText(screen.getByLabelText('Set 1 reps'), '6');
    await fireEvent.changeText(screen.getByLabelText('Date'), '2026-10-29');
    await fireEvent.changeText(screen.getByLabelText('Start'), '07:15');
    await fireEvent.changeText(screen.getByLabelText('Minutes'), '45');
    // No rest timer when editing.
    expect(screen.queryByText(/Rest \d/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(workoutsMock.saveWorkout).toHaveBeenCalled());
    const payload = workoutsMock.saveWorkout.mock.calls[0]![0] as unknown as {
      p_workout: { id: string; started_at: string; ended_at: string };
      p_sets: { id: string; reps: number }[];
    };
    expect(payload.p_workout.id).toBe('w-1');
    expect(new Date(payload.p_workout.started_at)).toEqual(new Date(2026, 9, 29, 7, 15));
    expect(Date.parse(payload.p_workout.ended_at) - Date.parse(payload.p_workout.started_at)).toBe(
      45 * 60_000,
    );
    expect(payload.p_sets).toEqual([expect.objectContaining({ id: 'set-1', reps: 6 })]);
  });

  it('rejects an edit dated in the future', async () => {
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit workout' }));
    await fireEvent.changeText(await screen.findByLabelText('Date'), '2099-01-01');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Can’t be in the future')).toBeOnTheScreen();
    expect(workoutsMock.saveWorkout).not.toHaveBeenCalled();
  });

  it('deletes a past workout after confirming', async () => {
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete workout' }));
    await waitFor(() =>
      expect(workoutsMock.deleteWorkout).toHaveBeenCalledWith('w-1', expect.anything()),
    );
  });

  it('saves a workout as a template', async () => {
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Save as template' }));
    await fireEvent.changeText(screen.getByLabelText('Template name'), 'Bench day');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Save template' }).at(-1)!);
    await waitFor(() =>
      expect(templatesMock.templateFromWorkout).toHaveBeenCalledWith('w-1', 'Bench day'),
    );
  });
});

describe('history', () => {
  it('lists workouts by month and shows training days on the calendar', async () => {
    await renderRouter(appDir, { initialUrl: '/history' });
    expect(await screen.findByText('Saved workout')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: /· 1$/ })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('radio', { name: 'Calendar' }));
    expect(await screen.findByText('1 training day')).toBeOnTheScreen();
    expect(screen.getByText('Saved workout')).toBeOnTheScreen(); // today is selected
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('button', { name: 'Next month' })).not.toBeDisabled();
    await act(async () => {});
  });
});

describe('admin templates', () => {
  it('admins hide a ready-made template from the Admin tab', async () => {
    resetBackend({ session: fakeSession(), profile: onboardedProfile({ role: 'admin' }) });
    await renderRouter(appDir, { initialUrl: '/admin/templates' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Push details' }));
    await waitFor(() => expect(screen).toHavePathname('/admin/template'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Hide from users' }));
    await waitFor(() =>
      expect(templatesMock.adminSetTemplateHidden).toHaveBeenCalledWith('tpl-push', true),
    );
    const card = screen.getByLabelText('Program');
    expect(within(card.parent!).getByDisplayValue('Push Pull Legs')).toBeOnTheScreen();
  });
});
