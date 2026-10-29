import { describeError } from '@/lib/errors';

describe('describeError', () => {
  it('detects no internet (web and native wording)', () => {
    expect(describeError({ message: 'TypeError: Failed to fetch', code: '' }).kind).toBe('offline');
    expect(describeError(new TypeError('Network request failed')).kind).toBe('offline');
  });

  it('names the missing table when migrations are not applied', () => {
    const d = describeError({
      code: 'PGRST205',
      message: "Could not find the table 'public.exercises' in the schema cache",
    });
    expect(d).toMatchObject({ kind: 'missing', title: 'Database not set up' });
    expect(d.message).toContain('“exercises” table');
    expect(d.detail).toBe(
      "PGRST205: Could not find the table 'public.exercises' in the schema cache",
    );
    expect(
      describeError({ code: '42P01', message: 'relation "public.workouts" does not exist' })
        .message,
    ).toContain('“workouts” table');
  });

  it('names a missing function', () => {
    const d = describeError({
      code: 'PGRST202',
      message:
        'Could not find the function public.save_workout(p_sets, p_workout) in the schema cache',
    });
    expect(d.message).toContain('“save_workout” function');
  });

  it('detects permission and expired sessions', () => {
    expect(
      describeError({ code: '42501', message: 'permission denied for table exercises' }).kind,
    ).toBe('permission');
    expect(describeError({ code: '42501', message: 'admin only' }).title).toBe('Not allowed');
    expect(describeError({ code: 'PGRST301', message: 'JWT expired' }).kind).toBe('session');
  });

  it('falls back to the server message', () => {
    expect(
      describeError({ code: '23514', message: 'new row violates check constraint' }),
    ).toMatchObject({
      kind: 'server',
      message: 'new row violates check constraint',
    });
    expect(describeError('weird').message).toBe('weird');
  });
});

describe('shouldRetry', () => {
  const { shouldRetry } = jest.requireActual('@/lib/queryClient');
  it('never retries errors that will not fix themselves', () => {
    expect(shouldRetry(0, { code: 'PGRST205', message: "table 'public.x'" })).toBe(false);
    expect(shouldRetry(0, { code: '42501', message: 'permission denied' })).toBe(false);
  });
  it('retries a network error once', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(1, new TypeError('Failed to fetch'))).toBe(false);
  });
});
