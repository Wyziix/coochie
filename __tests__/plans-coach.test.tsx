import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { usePlanDraftStore } from '@/stores/planDraftStore';
import {
  aiMock,
  aiState,
  fakeSession,
  onboardedProfile,
  resetBackend,
  resetProgress,
  resetTemplates,
  sampleFeedback,
  samplePlan,
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
  resetTemplates();
  resetBackend({ session: fakeSession(), profile: onboardedProfile({ role }) });
  usePlanDraftStore.getState().clear();
}

beforeEach(() => {
  jest.clearAllMocks();
  const { Alert } = require('react-native');
  // Confirm dialogs: press the last button (the confirming one).
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    ((args[2] as { onPress?: () => void }[] | undefined) ?? []).at(-1)?.onPress?.();
  });
});

afterEach(() => act(() => onlineManager.setOnline(true)));

describe('AI plan generator', () => {
  it('builds a plan from the form and shows the preview (nothing saved yet)', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/plans/new' });
    expect(await screen.findByText('2 of 2 plans left today')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Home dumbbells' }));
    await fireEvent.press(screen.getByRole('radio', { name: '45' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Build my plan' }));
    await waitFor(() => expect(screen).toHavePathname('/plans/preview'));
    // From the profile: strength, intermediate, 4 days.
    expect(aiMock.generatePlan).toHaveBeenCalledWith({
      goal: 'strength',
      experience: 'intermediate',
      days_per_week: 4,
      session_minutes: 45,
      equipment: 'home_dumbbells',
    });
    expect(await screen.findByText(samplePlan.name)).toBeOnTheScreen();
    expect(screen.getByText('Full body 1')).toBeOnTheScreen();
    expect(screen.getAllByText('3 × 6–8 · rest 2:30')).toHaveLength(3);
    expect(screen.getAllByText('3 × 5 · rest 3:00')).toHaveLength(3);
    expect(await screen.findByText('1 of 2 plans left today')).toBeOnTheScreen();
    expect(aiMock.savePlan).not.toHaveBeenCalled();
  });

  it('accept saves it as a program of templates, shown under My programs', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/plans/new' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Build my plan' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(screen).toHavePathname('/workout'));
    const [program, days] = aiMock.savePlan.mock.calls[0]!;
    expect(program).toEqual(
      expect.objectContaining({ name: samplePlan.name, weeks: 6, notes: samplePlan.notes }),
    );
    expect(days).toHaveLength(3);
    expect(days[0]!.p_template).toEqual(
      expect.objectContaining({ name: 'Full body 1', notes: 'Squat, press and pull' }),
    );
    expect(days[0]!.p_exercises[0]).toEqual({
      exercise_id: 'ex-bench',
      target_sets: 3,
      target_reps_min: 6,
      target_reps_max: 8,
      target_duration_seconds: null,
      rest_seconds: 150,
    });
    expect(days[0]!.p_exercises[1]).toEqual(
      expect.objectContaining({ target_reps_min: 5, target_reps_max: null }),
    );
    expect(await screen.findByText(samplePlan.name)).toBeOnTheScreen();
    expect(screen.getByText('3 days · 6 weeks')).toBeOnTheScreen();
    expect(screen.getByText('Full body 2')).toBeOnTheScreen();
  });

  it('a day can be edited in the template editor before saving', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/plans/new' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Build my plan' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit Full body 1' }));
    await waitFor(() => expect(screen).toHavePathname('/plans/edit-day'));
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Heavy day');
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen).toHavePathname('/plans/preview'));
    expect(await screen.findByText('Heavy day')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(aiMock.savePlan).toHaveBeenCalled());
    expect(aiMock.savePlan.mock.calls[0]![1][0]!.p_template.name).toBe('Heavy day');
  });

  it('regenerate counts toward the limit; the 3rd plan of the day is blocked', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/plans/new' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Build my plan' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(aiMock.generatePlan).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText('You’ve used your 2 plans for today. You get new ones tomorrow.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
  });

  it('shows the server’s message when it refuses', async () => {
    start();
    aiState.status.features.plan.remaining = 1;
    await renderRouter(appDir, { initialUrl: '/plans/new' });
    aiState.status.features.plan.remaining = 0; // used up on another device meanwhile
    await fireEvent.press(await screen.findByRole('button', { name: 'Build my plan' }));
    expect(
      await screen.findByText(
        "You've used your 2 plan generations for today. You get new ones tomorrow.",
      ),
    ).toBeOnTheScreen();
    expect(screen).toHavePathname('/plans/new');
  });

  it('needs a connection offline', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/plans/new' });
    await act(() => onlineManager.setOnline(false));
    expect(await screen.findByText('Needs connection')).toBeOnTheScreen();
  });

  it('a whole program is deleted at once', async () => {
    start();
    await aiMock.savePlan({ name: 'PPL', weeks: 8, notes: [] } as never, [
      { p_template: { name: 'PPL day 1' }, p_exercises: [] },
      { p_template: { name: 'PPL day 2' }, p_exercises: [] },
    ]);
    await renderRouter(appDir, { initialUrl: '/workout' });
    expect(await screen.findByText('PPL')).toBeOnTheScreen();
    expect(screen.getByText('2 days · 8 weeks')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete program' }));
    await waitFor(() =>
      expect(aiMock.deleteProgram).toHaveBeenCalledWith('prog-1', expect.anything()),
    );
    await waitFor(() => expect(screen.queryByText('PPL')).toBeNull());
    expect(screen.queryByText('PPL day 1')).toBeNull();
  });
});

describe('AI coach', () => {
  it('streams the reply and keeps the chat', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/coach' });
    expect(await screen.findByText('Ask your coach')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Message'), 'How is my bench?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Your bench went from 95x5 to 100x3.')).toBeOnTheScreen();
    expect(screen.getByText('How is my bench?')).toBeOnTheScreen();
    expect(aiMock.sendCoachMessage).toHaveBeenCalledWith('How is my bench?', expect.any(Function));
    expect(await screen.findByText('14 of 15 messages left today')).toBeOnTheScreen();
    expect(screen.getByLabelText('Message')).toHaveDisplayValue('');
  });

  it('shows "Gleb is thinking" until the first words arrive, then the text as it streams', async () => {
    start();
    let send!: (text: string) => void;
    let finish!: () => void;
    aiMock.sendCoachMessage.mockImplementationOnce(
      (question: string, onText: (t: string) => void) =>
        new Promise((resolve) => {
          send = onText;
          finish = () =>
            resolve([
              { id: 'q', role: 'user', content: question, created_at: '1' },
              { id: 'a', role: 'assistant', content: 'Sleep 8 hours.', created_at: '2' },
            ]);
        }),
    );
    await renderRouter(appDir, { initialUrl: '/coach' });
    await fireEvent.press(
      await screen.findByRole('button', { name: 'How much protein do I need?' }),
    );
    expect(await screen.findByLabelText('Gleb is thinking…')).toBeOnTheScreen();
    await act(async () => send('Sleep'));
    expect(await screen.findByText('Sleep')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Gleb is thinking…')).toBeNull();
    await act(async () => finish());
    expect(await screen.findByText('Sleep 8 hours.')).toBeOnTheScreen();
  });

  it('the 16th message is refused with a clear message, and the question is kept', async () => {
    start();
    aiState.status.features.coach = { limit: 15, used: 14, remaining: 1 };
    aiState.coachError = {
      code: 'limit',
      message: "You've used your 15 coach messages for today. You get new ones tomorrow.",
    };
    await renderRouter(appDir, { initialUrl: '/coach' });
    await fireEvent.changeText(await screen.findByLabelText('Message'), 'One more');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText(
        "You've used your 15 coach messages for today. You get new ones tomorrow.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Message')).toHaveDisplayValue('One more');
  });

  it('offline: old messages stay readable, sending shows "Needs connection"', async () => {
    start();
    aiState.coach = [
      { id: 'm1', role: 'user', content: 'Rest days?', created_at: '1' },
      { id: 'm2', role: 'assistant', content: 'Two a week is fine.', created_at: '2' },
    ];
    await renderRouter(appDir, { initialUrl: '/coach' });
    expect(await screen.findByText('Two a week is fine.')).toBeOnTheScreen();
    await act(() => onlineManager.setOnline(false));
    expect(await screen.findByText('Needs connection')).toBeOnTheScreen();
    expect(screen.getByText('Two a week is fine.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('Clear chat deletes the conversation after confirming', async () => {
    start();
    aiState.coach = [{ id: 'm1', role: 'user', content: 'Rest days?', created_at: '1' }];
    await renderRouter(appDir, { initialUrl: '/coach' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Clear chat' }));
    await waitFor(() => expect(aiMock.clearCoachChat).toHaveBeenCalled());
    expect(await screen.findByText('Ask your coach')).toBeOnTheScreen();
    expect(screen.queryByText('Rest days?')).toBeNull();
  });

  it('is opened from Home and the Progress tab', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ask the coach' }));
    await waitFor(() => expect(screen).toHavePathname('/coach'));
    await renderRouter(appDir, { initialUrl: '/progress' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ask the coach' }));
    await waitFor(() => expect(screen).toHavePathname('/coach'));
  });
});

describe('admin: limits per feature', () => {
  it('changes plan and coach limits and their output tokens', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/ai' });
    await fireEvent.changeText(await screen.findByLabelText('Plans'), '3');
    await fireEvent.changeText(screen.getByLabelText('Coach messages'), '20');
    await fireEvent.changeText(screen.getByLabelText('Max tokens: plan'), '1600');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(aiMock.updateAiSettings).toHaveBeenLastCalledWith({
        limit_plan: 3,
        limit_coach: 20,
        max_tokens_plan: 1600,
      }),
    );
  });

  it('sets an override for one feature only', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/ai' });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Coach' }));
    expect(screen.getByText('Everyone else gets 15 a day.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Find a user (name or email)'), 'anna');
    await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Set 10' }));
    await waitFor(() => expect(aiMock.setAiOverride).toHaveBeenCalledWith('user-2', 10, 'coach'));
    expect(await screen.findByText('Anna: 10 a day')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Plans' }));
    expect(screen.getByText('No overrides for this feature.')).toBeOnTheScreen();
  });
});

describe('"Gleb is thinking"', () => {
  it('shows while workout feedback is being written', async () => {
    start();
    let done!: () => void;
    aiMock.requestWorkoutFeedback.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = () =>
            resolve({
              feedback: { id: 'f', content: sampleFeedback, created_at: '', source_updated_at: '' },
              cached: false,
              stale: false,
            });
        }),
    );
    await renderRouter(appDir, { initialUrl: '/workouts/w-1' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Get AI feedback' }));
    expect(
      await screen.findByText('Gleb is thinking… Usually under 10 seconds.'),
    ).toBeOnTheScreen();
    await act(() => done());
  });
});
