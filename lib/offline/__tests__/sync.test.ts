import { onlineManager } from '@tanstack/react-query';

import { enqueue, loadOutbox, useOutboxStore } from '@/lib/offline/outbox';
import { isRetryable, retryOutboxItem, syncNow } from '@/lib/offline/sync';

const mockSession = { current: { user: { id: 'user-a' } } as { user: { id: string } } | null };
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: mockSession.current } }) },
  }),
}));
jest.mock('@/lib/api/workouts', () => ({
  saveWorkout: jest.fn(async () => ({ id: 'w' })),
  deleteWorkoutAt: jest.fn(async () => {}),
}));
jest.mock('@/lib/api/templates', () => ({
  saveTemplate: jest.fn(async () => ({})),
  deleteTemplateAt: jest.fn(async () => {}),
}));
jest.mock('@/lib/api/exercises', () => ({
  upsertCustomExercise: jest.fn(async () => ({})),
  saveRestSetting: jest.fn(async () => {}),
  fetchExercises: jest.fn(),
  fetchLastSets: jest.fn(),
  fetchRecentExerciseIds: jest.fn(),
  fetchRestSettings: jest.fn(),
}));

const api = {
  workouts: jest.requireMock('@/lib/api/workouts'),
  exercises: jest.requireMock('@/lib/api/exercises'),
};
const memory: Map<string, string> = jest.requireMock('@/lib/offline/storage').__memory;

const workout = (id: string, name = 'Push') => ({
  kind: 'save_workout' as const,
  entityId: id,
  payload: {
    p_workout: { id, name, started_at: '2026-10-29T10:00:00Z', ended_at: '2026-10-29T11:00:00Z' },
    p_sets: [],
  },
  label: `Workout ${name}`,
});

const network = (message = 'TypeError: Failed to fetch') =>
  Object.assign(new Error(message), { code: '' });
const refused = (code: string, message: string) => Object.assign(new Error(message), { code });

beforeEach(async () => {
  jest.clearAllMocks();
  memory.clear();
  mockSession.current = { user: { id: 'user-a' } };
  onlineManager.setOnline(true);
  useOutboxStore.setState({ userId: null, items: [], loaded: false, sending: [] });
  await loadOutbox('user-a');
});

describe('which errors are retried', () => {
  it.each([
    ['no connection', network(), true],
    ['session expired', Object.assign(new Error('JWT expired'), { code: 'PGRST301' }), true],
    ['server down', Object.assign(new Error('Bad gateway'), { status: 502 }), true],
    ['exercise deleted', refused('23503', 'exercise x not available'), false],
    ['invalid data', refused('22023', 'a workout needs at least one completed set'), false],
    ['not allowed', refused('42501', 'workout belongs to someone else'), false],
    ['duplicate name', refused('23505', 'duplicate key'), false],
  ])('%s', (_label, error, retry) => {
    expect(isRetryable(error)).toBe(retry);
  });
});

describe('syncNow', () => {
  it('sends queued changes in order through the server functions, then clears them', async () => {
    await enqueue(workout('w1'), '2026-10-29T11:00:00Z');
    await enqueue({ kind: 'save_rest', entityId: 'ex-1', payload: { seconds: 90 }, label: 'Rest' });
    const result = await syncNow();
    expect(result).toEqual({ sent: 2, failed: 0, left: 0 });
    expect(api.workouts.saveWorkout).toHaveBeenCalledWith(
      expect.objectContaining({
        p_workout: expect.objectContaining({ id: 'w1', client_updated_at: '2026-10-29T11:00:00Z' }),
      }),
    );
    expect(api.exercises.saveRestSetting).toHaveBeenCalledWith('ex-1', 90);
    expect(useOutboxStore.getState().items).toEqual([]);
  });

  it('sends nothing while offline', async () => {
    await enqueue(workout('w1'));
    onlineManager.setOnline(false);
    await syncNow();
    expect(api.workouts.saveWorkout).not.toHaveBeenCalled();
    expect(useOutboxStore.getState().items).toHaveLength(1);
  });

  it('stops at a lost connection and keeps everything, in order', async () => {
    await enqueue(workout('w1'));
    await enqueue(workout('w2'));
    api.workouts.saveWorkout.mockRejectedValueOnce(network());
    const result = await syncNow();
    expect(result.sent).toBe(0);
    expect(api.workouts.saveWorkout).toHaveBeenCalledTimes(1);
    expect(useOutboxStore.getState().items.map((i) => [i.entityId, i.status, i.attempts])).toEqual([
      ['w1', 'pending', 1],
      ['w2', 'pending', 0],
    ]);
  });

  it('a permanently refused change is kept and shown, the rest still syncs', async () => {
    await enqueue(workout('w1', 'Deleted exercise'));
    await enqueue(workout('w2', 'Fine'));
    api.workouts.saveWorkout.mockRejectedValueOnce(refused('23503', 'exercise x not available'));
    const result = await syncNow();
    expect(result).toEqual({ sent: 1, failed: 1, left: 1 });
    const [item] = useOutboxStore.getState().items;
    expect(item).toMatchObject({ entityId: 'w1', status: 'failed' });
    expect(item!.error).toMatch(/exercise x not available/);
    // Not retried by itself...
    await syncNow();
    expect(api.workouts.saveWorkout).toHaveBeenCalledTimes(2);
    // ...only when asked.
    await retryOutboxItem(item!.id);
    expect(api.workouts.saveWorkout).toHaveBeenCalledTimes(3);
    expect(useOutboxStore.getState().items).toEqual([]);
  });

  it('unknown errors become a problem after a few tries instead of retrying forever', async () => {
    await enqueue(workout('w1'));
    api.workouts.saveWorkout.mockRejectedValue(new Error('something odd'));
    for (let i = 0; i < 5; i++) await syncNow();
    expect(useOutboxStore.getState().items[0]).toMatchObject({ status: 'failed', attempts: 5 });
    await syncNow();
    expect(api.workouts.saveWorkout).toHaveBeenCalledTimes(5);
  });

  it('never sends one account’s changes with another account’s session', async () => {
    await enqueue(workout('w1'));
    mockSession.current = { user: { id: 'user-b' } };
    const result = await syncNow();
    expect(result.sent).toBe(0);
    expect(api.workouts.saveWorkout).not.toHaveBeenCalled();
    mockSession.current = null;
    await syncNow();
    expect(api.workouts.saveWorkout).not.toHaveBeenCalled();
  });

  it('runs once at a time', async () => {
    await enqueue(workout('w1'));
    const [a, b] = [syncNow(), syncNow()];
    expect(a).toBe(b);
    await a;
    expect(api.workouts.saveWorkout).toHaveBeenCalledTimes(1);
  });
});
