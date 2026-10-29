import type { Session } from '@supabase/supabase-js';

import type { Exercise } from '@/lib/api/exercises';
import type { Profile } from '@/lib/api/profiles';
import { useAuthStore } from '@/stores/authStore';

// In-memory stand-ins for Supabase used by screen and routing tests.
// Wire up with:
//   jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
//   jest.mock('@/lib/supabase', () => require('@/test-utils/backend').supabaseMock);
//   jest.mock('@/lib/api/profiles', () => require('@/test-utils/backend').profilesMock);
//   jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);
//   jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);
//   jest.mock('@/lib/api/templates', () => require('@/test-utils/backend').templatesMock);

export const USER_ID = '11111111-1111-1111-1111-111111111111';

type Listener = (event: string, session: Session | null) => void;

export const backend = {
  session: null as Session | null,
  profile: null as Profile | null,
  takenUsernames: new Set<string>(['taken']),
  listeners: new Set<Listener>(),
};

export function fakeSession(userId = USER_ID): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

export function fakeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: USER_ID,
    username: null,
    display_name: 'Gleb K',
    avatar_url: null,
    units: 'kg',
    goal: null,
    experience_level: null,
    training_days_per_week: null,
    bodyweight_kg: null,
    height_cm: null,
    onboarding_completed_at: null,
    role: 'user',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export const onboardedProfile = (overrides: Partial<Profile> = {}) =>
  fakeProfile({
    username: 'gleb',
    goal: 'strength',
    experience_level: 'intermediate',
    training_days_per_week: 4,
    bodyweight_kg: 80,
    onboarding_completed_at: '2026-01-02T00:00:00Z',
    ...overrides,
  });

export function resetBackend({
  session = null,
  profile = null,
}: { session?: Session | null; profile?: Profile | null } = {}) {
  backend.session = session;
  backend.profile = profile;
  backend.listeners.clear();
  // The auth store is a module-level singleton; start each test like a fresh app launch.
  useAuthStore.setState({ status: 'loading', session: null });
}

function emit(event: string) {
  backend.listeners.forEach((l) => l(event, backend.session));
}

const client = {
  auth: {
    onAuthStateChange: (listener: Listener) => {
      backend.listeners.add(listener);
      listener('INITIAL_SESSION', backend.session);
      return { data: { subscription: { unsubscribe: () => backend.listeners.delete(listener) } } };
    },
    signOut: jest.fn(async () => {
      backend.session = null;
      emit('SIGNED_OUT');
      return { error: null };
    }),
  },
};

export const envMock = {
  env: {
    supabaseUrl: 'https://test.supabase.co',
    supabasePublishableKey: 'sb_publishable_test',
    googleWebClientId: 'web-client-id',
    googleIosClientId: '',
  },
  isSupabaseConfigured: true,
};

export const supabaseMock = { getSupabase: () => client };

const actualProfiles = jest.requireActual('@/lib/api/profiles');

export const profilesMock = {
  ...actualProfiles,
  fetchProfile: jest.fn(async () => backend.profile),
  saveProfile: jest.fn(async (_userId: string, patch: Partial<Profile>) => {
    if (patch.username && backend.takenUsernames.has(patch.username)) {
      throw new actualProfiles.UsernameTakenError();
    }
    backend.profile = { ...(backend.profile ?? fakeProfile()), ...patch } as Profile;
    return backend.profile;
  }),
  isUsernameAvailable: jest.fn(async (name: string) => !backend.takenUsernames.has(name)),
  uploadAvatar: jest.fn(async () => 'https://test.supabase.co/avatar.jpg'),
};

// --- Stage 2: exercises and workouts --------------------------------------

export const fakeExercise = (p: Partial<Exercise> & { id: string; name: string }): Exercise => ({
  slug: null,
  primary_muscle: 'chest',
  secondary_muscles: [],
  equipment: 'barbell',
  type: 'weights',
  instructions: 'Do it well.',
  default_rest_seconds: 90,
  owner_id: null,
  is_hidden: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...p,
});

export const exercisesState = {
  list: [
    fakeExercise({ id: 'ex-bench', name: 'Bench Press (Barbell)', secondary_muscles: ['triceps'] }),
    fakeExercise({
      id: 'ex-squat',
      name: 'Squat (Barbell)',
      primary_muscle: 'quads',
      default_rest_seconds: 180,
    }),
    fakeExercise({
      id: 'ex-plank',
      name: 'Plank',
      primary_muscle: 'abs',
      equipment: 'bodyweight',
      type: 'timed',
    }),
    fakeExercise({ id: 'ex-old', name: 'Old Hidden Move', is_hidden: true }),
  ] as Exercise[],
};

const actualExercises = jest.requireActual('@/lib/api/exercises');

export const exercisesMock = {
  ...actualExercises,
  fetchExercises: jest.fn(async () => exercisesState.list),
  fetchRestSettings: jest.fn(async () => ({ 'ex-bench': 120 })),
  fetchRecentExerciseIds: jest.fn(async () => ['ex-squat']),
  saveRestSetting: jest.fn(async () => {}),
  fetchLastSets: jest.fn(async () => [
    {
      exercise_id: 'ex-bench',
      set_index: 1,
      set_type: 'normal',
      weight_kg: 80,
      reps: 5,
      rpe: null,
      duration_seconds: null,
      distance_m: null,
      performed_at: '2026-10-01T10:00:00Z',
    },
  ]),
  adminSaveExercise: jest.fn(async (id: string | null, input: Partial<Exercise>) =>
    fakeExercise({ id: id ?? 'ex-new', name: input.name ?? 'New', ...input }),
  ),
  adminSetExerciseHidden: jest.fn(async (id: string, hidden: boolean) => ({
    ...exercisesState.list.find((e) => e.id === id)!,
    is_hidden: hidden,
  })),
};

const savedWorkout = (id: string, startedAt = '2026-10-30T10:00:00Z') => ({
  id,
  user_id: USER_ID,
  name: 'Saved workout',
  started_at: startedAt,
  ended_at: '2026-10-30T11:00:00Z',
  duration_seconds: 3600,
  total_volume_kg: 400,
  notes: null,
  template_id: null,
  created_at: '',
  updated_at: '',
});

export const workoutsMock = {
  saveWorkout: jest.fn(async (payload: { p_workout: { id: string; name: string } }) => ({
    ...savedWorkout(payload.p_workout.id),
    name: payload.p_workout.name,
  })),
  fetchRecentWorkouts: jest.fn(async () => []),
  fetchWorkoutsPage: jest.fn(async (page: number) =>
    page === 0 ? [{ ...savedWorkout('w-1', new Date().toISOString()), set_count: 4 }] : [],
  ),
  fetchWorkoutsBetween: jest.fn(async () => [
    { ...savedWorkout('w-1', new Date().toISOString()), set_count: 4 },
  ]),
  deleteWorkout: jest.fn(async () => {}),
  fetchWorkout: jest.fn(async (id: string) => ({
    ...savedWorkout(id),
    sets: [
      {
        id: 'set-1',
        workout_id: id,
        user_id: USER_ID,
        exercise_id: 'ex-bench',
        exercise_order: 0,
        set_order: 0,
        set_type: 'normal',
        weight_kg: 80,
        reps: 5,
        rpe: null,
        duration_seconds: null,
        distance_m: null,
        created_at: '',
        updated_at: '',
        exercise: { id: 'ex-bench', name: 'Bench Press (Barbell)', type: 'weights' },
      },
    ],
  })),
};

const templateExercise = (templateId: string, e: Exercise, position: number, sets = 3) => ({
  id: `${templateId}-${e.id}`,
  template_id: templateId,
  exercise_id: e.id,
  position,
  target_sets: sets,
  target_reps_min: 8,
  target_reps_max: 12,
  target_duration_seconds: null,
  rest_seconds: null,
  exercise: {
    id: e.id,
    name: e.name,
    type: e.type,
    primary_muscle: e.primary_muscle,
    default_rest_seconds: e.default_rest_seconds,
    is_hidden: e.is_hidden,
  },
});

export const templatesState = {
  list: [] as unknown[],
};

export function resetTemplates() {
  const [bench, squat] = exercisesState.list;
  templatesState.list = [
    {
      id: 'tpl-push',
      owner_id: null,
      name: 'Push',
      notes: 'Chest, shoulders, triceps.',
      program: 'Push Pull Legs',
      position: 1,
      is_hidden: false,
      created_at: '',
      updated_at: '',
      exercises: [templateExercise('tpl-push', bench!, 0, 4)],
    },
    {
      id: 'tpl-mine',
      owner_id: USER_ID,
      name: 'My Legs',
      notes: null,
      program: null,
      position: 0,
      is_hidden: false,
      created_at: '',
      updated_at: '',
      exercises: [templateExercise('tpl-mine', squat!, 0, 5)],
    },
  ];
}
resetTemplates();

const saveTemplateImpl = (owner: string | null) =>
  jest.fn(async (id: string | null, payload: { p_template: { name: string } }) => ({
    id: id ?? 'tpl-new',
    owner_id: owner,
    name: payload.p_template.name,
  }));

export const templatesMock = {
  fetchTemplates: jest.fn(async () => templatesState.list),
  saveTemplate: saveTemplateImpl(USER_ID),
  deleteTemplate: jest.fn(async () => {}),
  templateFromWorkout: jest.fn(async (_w: string, name: string) => ({
    id: 'tpl-from-workout',
    name,
  })),
  adminSaveTemplate: saveTemplateImpl(null),
  adminSetTemplateHidden: jest.fn(async (id: string, hidden: boolean) => ({
    id,
    is_hidden: hidden,
  })),
  adminDeleteTemplate: jest.fn(async () => {}),
};

// --- Stage 4: progress, body, photos ----------------------------------------

export const progressState = {
  newRecords: [] as unknown[],
};

export const progressMock = {
  fetchWorkoutRecords: jest.fn(async () => progressState.newRecords),
  fetchExerciseRecords: jest.fn(async () => [
    {
      id: 1,
      user_id: USER_ID,
      exercise_id: 'ex-bench',
      record_type: 'heaviest_weight',
      bucket_kg: 0,
      value: 100,
      weight_kg: 100,
      reps: 3,
      workout_id: 'w-1',
      set_id: 's',
      achieved_at: '2026-10-20T10:00:00Z',
      previous_value: 95,
    },
    {
      id: 2,
      user_id: USER_ID,
      exercise_id: 'ex-bench',
      record_type: 'best_e1rm',
      bucket_kg: 0,
      value: 116.67,
      weight_kg: 100,
      reps: 5,
      workout_id: 'w-1',
      set_id: 's',
      achieved_at: '2026-10-20T10:00:00Z',
      previous_value: null,
    },
    {
      id: 3,
      user_id: USER_ID,
      exercise_id: 'ex-bench',
      record_type: 'reps_at_weight',
      bucket_kg: 80,
      value: 10,
      weight_kg: 80,
      reps: 10,
      workout_id: 'w-1',
      set_id: 's',
      achieved_at: '2026-10-20T10:00:00Z',
      previous_value: 8,
    },
  ]),
  fetchRecentRecords: jest.fn(async () => [
    {
      id: 1,
      user_id: USER_ID,
      exercise_id: 'ex-bench',
      record_type: 'heaviest_weight',
      bucket_kg: 0,
      value: 100,
      weight_kg: 100,
      reps: 3,
      workout_id: 'w-1',
      set_id: 's',
      achieved_at: '2026-10-20T10:00:00Z',
      previous_value: 95,
      exercise: { id: 'ex-bench', name: 'Bench Press (Barbell)', type: 'weights' },
    },
  ]),
  fetchExerciseHistory: jest.fn(async () => [
    {
      workout_id: 'w-0',
      started_at: '2026-10-13T10:00:00Z',
      max_weight_kg: 95,
      best_e1rm_kg: 110.83,
      volume_kg: 1425,
      total_reps: 15,
      max_duration_seconds: null,
      total_distance_m: null,
    },
    {
      workout_id: 'w-1',
      started_at: '2026-10-20T10:00:00Z',
      max_weight_kg: 100,
      best_e1rm_kg: 116.67,
      volume_kg: 1500,
      total_reps: 15,
      max_duration_seconds: null,
      total_distance_m: null,
    },
  ]),
  fetchTrainedExercises: jest.fn(async () => [
    {
      exercise_id: 'ex-bench',
      name: 'Bench Press (Barbell)',
      type: 'weights',
      primary_muscle: 'chest',
      sessions: 2,
      last_performed: '2026-10-20T10:00:00Z',
    },
  ]),
  fetchWeeklyOverview: jest.fn(async () => ({
    workouts: 2,
    volume_kg: 5200,
    duration_seconds: 7200,
    sets: 30,
    muscles: [
      { muscle: 'chest', sets: 9 },
      { muscle: 'triceps', sets: 4.5 },
    ],
  })),
};

export const bodyState = { list: [] as unknown[] };

export const bodyMock = {
  fetchMeasurements: jest.fn(async () => bodyState.list),
  saveMeasurement: jest.fn(async (input: Record<string, unknown>) => {
    const row = {
      id: `m-${bodyState.list.length + 1}`,
      user_id: USER_ID,
      created_at: '',
      updated_at: '',
      ...input,
    };
    bodyState.list = [row, ...bodyState.list];
    if (typeof input.bodyweight_kg === 'number' && backend.profile) {
      backend.profile = { ...backend.profile, bodyweight_kg: input.bodyweight_kg };
    }
    return row;
  }),
  deleteMeasurement: jest.fn(async () => {}),
};

export const photosState = { list: [] as unknown[] };

// Photo lock: behaves like the SQL (photo_lock.test.sql): 5 wrong → 15 min lockout,
// photos only with a token the "server" issued.
export const photoLockState = {
  state: 'pin' as 'setup' | 'pin' | 'password' | 'none',
  secret: '2580',
  failed: 0,
  lockedUntil: null as number | null,
  tokens: new Set<string>(),
  issued: 0,
};

function issueToken() {
  const token = `tok-${++photoLockState.issued}`;
  photoLockState.tokens.add(token);
  return { ok: true as const, token, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() };
}

function checkSecret(secret: string | undefined) {
  const s = photoLockState;
  if (s.state === 'setup') return { ok: false as const, reason: 'setup' as const };
  if (s.state === 'none') return { ok: true as const };
  if (s.lockedUntil && s.lockedUntil > Date.now())
    return {
      ok: false as const,
      reason: 'locked' as const,
      locked_until: new Date(s.lockedUntil).toISOString(),
    };
  if (secret === s.secret) {
    s.failed = 0;
    s.lockedUntil = null;
    return { ok: true as const };
  }
  s.failed += 1;
  if (s.failed >= 5) {
    s.failed = 0;
    s.lockedUntil = Date.now() + 15 * 60_000;
    return {
      ok: false as const,
      reason: 'locked' as const,
      locked_until: new Date(s.lockedUntil).toISOString(),
    };
  }
  return { ok: false as const, reason: 'wrong' as const, attempts_left: 5 - s.failed };
}

export const photoLockMock = {
  fetchLockStatus: jest.fn(async () => ({
    state: photoLockState.state,
    locked_until:
      photoLockState.lockedUntil && photoLockState.lockedUntil > Date.now()
        ? new Date(photoLockState.lockedUntil).toISOString()
        : null,
    attempts_left: 5 - photoLockState.failed,
    photo_count: photosState.list.length,
    devices: 0,
  })),
  setupLock: jest.fn(async (kind: 'pin' | 'password', secret: string) => {
    photoLockState.state = kind;
    photoLockState.secret = secret;
    return issueToken();
  }),
  unlockPhotos: jest.fn(async (input: { secret?: string; deviceKey?: string }) => {
    const r = checkSecret(
      input.deviceKey === 'device-key' && biometricsState.enabled
        ? photoLockState.secret
        : input.secret,
    );
    return r.ok ? issueToken() : r;
  }),
  relockPhotos: jest.fn(async (token: string) => {
    photoLockState.tokens.delete(token);
  }),
  changeLockSecret: jest.fn(async (current: string, kind: 'pin' | 'password', secret: string) => {
    const r = checkSecret(current);
    if (!r.ok) return r;
    photoLockState.state = kind;
    photoLockState.secret = secret;
    photoLockState.tokens.clear();
    return { ok: true as const };
  }),
  removeLock: jest.fn(async (current: string) => {
    const r = checkSecret(current);
    if (!r.ok) return r;
    photoLockState.state = 'none';
    return { ok: true as const };
  }),
  resetLock: jest.fn(async () => {
    photoLockState.state = 'setup';
    photoLockState.tokens.clear();
  }),
  registerDevice: jest.fn(async () => ({ id: 'dev-1', key: 'device-key' })),
  forgetDevice: jest.fn(async () => {}),
};

export const biometricsState = { supported: false, enabled: false };

export const biometricsMock = {
  biometricsSupported: jest.fn(async () => biometricsState.supported),
  biometricsLabel: jest.fn(async () => 'fingerprint'),
  isBiometricsEnabled: jest.fn(async () => biometricsState.enabled),
  enableBiometrics: jest.fn(async () => {
    biometricsState.enabled = true;
  }),
  readDeviceKey: jest.fn(async () => (biometricsState.enabled ? 'device-key' : null)),
  clearLocalBiometrics: jest.fn(async () => {
    biometricsState.enabled = false;
  }),
  disableBiometrics: jest.fn(async () => {
    biometricsState.enabled = false;
  }),
};

/** Forgot PIN without the real Google sign-in. */
export const resetMock = {
  WRONG_ACCOUNT: 'wrong account',
  resetWithGoogle: jest.fn(async () => {
    await photoLockMock.resetLock();
    return 'done' as const;
  }),
  finishPendingReset: jest.fn(async () => 'none' as const),
};

function requireToken(token: string) {
  if (!photoLockState.tokens.has(token)) {
    const { PhotosLockedError } = jest.requireActual('@/lib/api/photos');
    throw new PhotosLockedError();
  }
}

export const photosMock = {
  PhotosLockedError: jest.requireActual('@/lib/api/photos').PhotosLockedError,
  fetchPhotos: jest.fn(async (token: string) => {
    requireToken(token);
    return photosState.list;
  }),
  uploadPhoto: jest.fn(async (token: string) => requireToken(token)),
  deletePhoto: jest.fn(async (token: string) => requireToken(token)),
};

export function resetPhotoLock(state: typeof photoLockState.state = 'pin') {
  Object.assign(photoLockState, { state, secret: '2580', failed: 0, lockedUntil: null, issued: 0 });
  photoLockState.tokens = new Set();
  Object.assign(biometricsState, { supported: false, enabled: false });
}

export function resetProgress() {
  resetPhotoLock();
  progressState.newRecords = [];
  bodyState.list = [
    {
      id: 'm-0',
      user_id: USER_ID,
      measured_on: '2026-10-01',
      bodyweight_kg: 81,
      body_fat_pct: null,
      neck_cm: null,
      shoulders_cm: null,
      chest_cm: null,
      waist_cm: 84,
      hips_cm: null,
      arm_cm: null,
      thigh_cm: null,
      calf_cm: null,
      notes: null,
      created_at: '',
      updated_at: '',
    },
  ];
  photosState.list = [
    {
      id: 'p-1',
      user_id: USER_ID,
      taken_on: '2026-10-20',
      storage_path: `${USER_ID}/p-1.jpg`,
      width: 1200,
      height: 1600,
      pose: 'front',
      notes: null,
      created_at: '',
      url: 'https://test/p1.jpg',
    },
    {
      id: 'p-2',
      user_id: USER_ID,
      taken_on: '2026-09-01',
      storage_path: `${USER_ID}/p-2.jpg`,
      width: 1200,
      height: 1600,
      pose: 'front',
      notes: null,
      created_at: '',
      url: 'https://test/p2.jpg',
    },
  ];
}
resetProgress();
