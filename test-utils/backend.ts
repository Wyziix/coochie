import type { Session } from '@supabase/supabase-js';
import { onlineManager } from '@tanstack/react-query';

import type { Exercise } from '@/lib/api/exercises';
import type { Profile } from '@/lib/api/profiles';
import { useOutboxStore } from '@/lib/offline/outbox';
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
    leaderboard_hidden: false,
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
  resetAi();
  resetPoints();
  resetSocial();
  // Fresh device: no offline data, nothing queued, online.
  jest.requireMock('@/lib/offline/storage').__memory.clear();
  useOutboxStore.setState({ userId: null, items: [], loaded: false, sending: [] });
  onlineManager.setOnline(true);
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
    getSession: jest.fn(async () => ({ data: { session: backend.session }, error: null })),
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
  upsertCustomExercise: jest.fn(async (_userId: string, id: string, input: Partial<Exercise>) => {
    const row = fakeExercise({ name: 'Custom', ...input, id, owner_id: USER_ID });
    exercisesState.list = [...exercisesState.list.filter((e) => e.id !== id), row];
    return row;
  }),
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
  client_updated_at: null,
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
  deleteWorkoutAt: jest.fn(async () => {}),
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

// Saved templates show up in later fetches, like on the real server.
const saveTemplateImpl = (owner: string | null) =>
  jest.fn(async (id: string | null, payload: { p_template: { name: string } }) => {
    const saved = { id: id ?? 'tpl-new', owner_id: owner, name: payload.p_template.name };
    const list = templatesState.list as { id: string }[];
    templatesState.list = list.some((t) => t.id === saved.id)
      ? list.map((t) => (t.id === saved.id ? { ...t, ...saved } : t))
      : [...list, { ...list[0], ...saved, program: null, exercises: [] }];
    return saved;
  });

export const templatesMock = {
  fetchTemplates: jest.fn(async () => templatesState.list),
  saveTemplate: saveTemplateImpl(USER_ID),
  deleteTemplateAt: jest.fn(async (id: string) => {
    templatesState.list = (templatesState.list as { id: string }[]).filter((t) => t.id !== id);
  }),
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

// --- Stage 6: AI (Claude is never called in tests) -----------------------------
const actualAi = jest.requireActual('@/lib/api/ai');

export const sampleFeedback = {
  summary: 'Bench top set 100x3, up from 95x5 by weight.',
  positives: ['Heaviest bench so far: 100 kg (was 95 kg).'],
  warnings: [],
  suggestions: ['Next time try 100x4 on bench.'],
  see_professional: false,
};

export const sampleReport = {
  summary: 'You trained 3 times, as planned, and volume rose 8%.',
  consistency: '3 of 3 planned sessions.',
  volume_trend: '12,400 kg, up from 11,500 kg.',
  highlights: ['Bench 100x3, a new heaviest set.'],
  focus_next_week: ['Add one pulling exercise.'],
  warnings: ['Left shoulder pain was noted.'],
  see_professional: true,
};

const features = () => ({
  workout_feedback: { limit: 3, used: 0, remaining: 3 },
  plan: { limit: 2, used: 0, remaining: 2 },
  coach: { limit: 15, used: 0, remaining: 15 },
});

export const samplePlan = {
  name: '3-day full body',
  description: 'Three full-body sessions a week for a beginner.',
  weeks: 6,
  progression: 'Add 2.5 kg when every set reaches the top of the rep range.',
  notes: ['Warm up with two lighter sets.'],
  days: [1, 2, 3].map((n) => ({
    name: `Full body ${n}`,
    focus: 'Squat, press and pull',
    exercises: [
      {
        exercise_id: 'ex-bench',
        name: 'Bench Press',
        sets: 3,
        reps_min: 6,
        reps_max: 8,
        rest_seconds: 150,
      },
      {
        exercise_id: 'ex-squat',
        name: 'Back Squat',
        sets: 3,
        reps_min: 5,
        reps_max: 5,
        rest_seconds: 180,
      },
      {
        exercise_id: 'ex-curl',
        name: 'Bicep Curl',
        sets: 2,
        reps_min: 10,
        reps_max: 12,
        rest_seconds: 60,
      },
    ],
  })),
};

type CoachRow = { id: string; role: 'user' | 'assistant'; content: string; created_at: string };

export const aiState = {
  status: {
    enabled: true,
    paused_for_budget: false,
    limit: 3,
    used_today: 0,
    remaining: 3,
    features: features(),
  },
  programs: [] as {
    id: string;
    name: string;
    description: string;
    weeks: number;
    notes: string[];
    created_at: string;
  }[],
  savedPlans: [] as { program: unknown; days: unknown[] }[],
  coach: [] as CoachRow[],
  /** What the fake coach streams back, in pieces. */
  coachReply: ['Your bench ', 'went from 95x5 to 100x3.'],
  /** Set to make the next coach message fail like the server would. */
  coachError: null as null | { code: string; message: string },
  feedback: new Map<string, unknown>(),
  reports: [] as {
    id: string;
    content: typeof sampleReport;
    created_at: string;
    week_start: string;
    seen_at: string | null;
  }[],
  settings: {
    enabled: true,
    daily_limit: 3,
    limit_workout_feedback: 3,
    limit_plan: 2,
    limit_coach: 15,
    max_tokens_plan: 1500,
    max_tokens_coach: 400,
    daily_budget_usd: 0.5,
    model: 'claude-haiku-5-5',
    max_tokens_feedback: 400,
    max_tokens_weekly: 700,
    price_input: 0.1,
    price_output: 0.5,
    price_cache_write: 0.125,
    price_cache_read: 0.01,
    timezone: 'Europe/Madrid',
    updated_at: '',
    spent_today_usd: 0.0021,
  },
  overrides: [] as {
    user_id: string;
    username: string;
    display_name: string;
    function: string;
    daily_limit: number;
  }[],
};

export function resetAi() {
  aiState.status = {
    enabled: true,
    paused_for_budget: false,
    limit: 3,
    used_today: 0,
    remaining: 3,
    features: features(),
  };
  aiState.programs = [];
  aiState.savedPlans = [];
  aiState.coach = [];
  aiState.coachReply = ['Your bench ', 'went from 95x5 to 100x3.'];
  aiState.coachError = null;
  aiState.feedback = new Map();
  aiState.reports = [];
  aiState.settings = {
    ...aiState.settings,
    enabled: true,
    daily_limit: 3,
    limit_workout_feedback: 3,
    limit_plan: 2,
    limit_coach: 15,
    max_tokens_plan: 1500,
    max_tokens_coach: 400,
    model: 'claude-haiku-5-5',
  };
  aiState.overrides = [];
}

export const aiMock = {
  AiError: actualAi.AiError,
  fetchAiStatus: jest.fn(async () => ({ ...aiState.status })),
  fetchWorkoutFeedback: jest.fn(async (id: string) => aiState.feedback.get(id) ?? null),
  // Like the server: the limit is checked before Claude would be called.
  requestWorkoutFeedback: jest.fn(async (id: string) => {
    const s = aiState.status;
    if (!s.enabled)
      throw new actualAi.AiError('disabled', 'AI features are switched off right now.');
    if (s.remaining <= 0)
      throw new actualAi.AiError(
        'limit',
        `You've used your ${s.limit} AI requests for today. You get new ones tomorrow.`,
      );
    s.used_today++;
    s.remaining--;
    const feedback = {
      id: `fb-${id}`,
      content: sampleFeedback,
      created_at: '2026-10-29T12:00:00Z',
      source_updated_at: '',
    };
    aiState.feedback.set(id, feedback);
    return { feedback, cached: false, stale: false };
  }),
  fetchWeeklyReports: jest.fn(async () => aiState.reports.map((r) => ({ ...r }))),
  markReportSeen: jest.fn(async (id: string) => {
    const r = aiState.reports.find((x) => x.id === id);
    if (r) r.seen_at = '2026-10-29T12:00:00Z';
  }),
  savePushToken: jest.fn(async () => {}),
  deletePushToken: jest.fn(async () => {}),
  fetchAiSettings: jest.fn(async () => ({ ...aiState.settings })),
  updateAiSettings: jest.fn(async (changes: Partial<typeof aiState.settings>) => {
    aiState.settings = { ...aiState.settings, ...changes };
    if (changes.enabled !== undefined) aiState.status.enabled = changes.enabled;
    return { ...aiState.settings };
  }),
  fetchAiOverrides: jest.fn(async () => [...aiState.overrides]),
  setAiOverride: jest.fn(
    async (userId: string, limit: number | null, feature = 'workout_feedback') => {
      aiState.overrides = aiState.overrides.filter(
        (o) => !(o.user_id === userId && o.function === feature),
      );
      if (limit !== null)
        aiState.overrides.push({
          user_id: userId,
          username: 'girlfriend',
          display_name: 'Anna',
          function: feature,
          daily_limit: limit,
        });
    },
  ),
  findUsers: jest.fn(async () => [
    { user_id: 'user-2', username: 'girlfriend', display_name: 'Anna', email: 'anna@test.dev' },
  ]),
  fetchAiUsage: jest.fn(async () => ({
    since: '2026-09-30',
    days: [
      { day: '2026-10-28', calls: 2, errors: 0, blocked: 1, cost_usd: 0.0005 },
      { day: '2026-10-29', calls: 3, errors: 1, blocked: 0, cost_usd: 0.0008 },
    ],
    top_users: [{ user_id: 'user-1', username: 'gleb', calls: 5, cost_usd: 0.0013 }],
    totals: {
      calls: 5,
      errors: 1,
      blocked: 1,
      error_rate: 0.2,
      cost_usd: 0.0013,
      input_tokens: 9000,
      output_tokens: 1500,
    },
  })),
  // Plans: like the server, the plan limit is checked before Claude would be called.
  generatePlan: jest.fn(async () => {
    const f = aiState.status.features.plan;
    if (!aiState.status.enabled)
      throw new actualAi.AiError('disabled', 'AI features are switched off right now.');
    if (f.remaining <= 0)
      throw new actualAi.AiError(
        'limit',
        `You've used your ${f.limit} plan generations for today. You get new ones tomorrow.`,
      );
    f.used++;
    f.remaining--;
    return { plan: JSON.parse(JSON.stringify(samplePlan)) };
  }),
  savePlan: jest.fn(
    async (
      program: { name: string; weeks: number; notes: string[] },
      days: { p_template: { name: string }; p_exercises: Record<string, unknown>[] }[],
    ) => {
      aiState.savedPlans.push({ program, days });
      const id = `prog-${aiState.savedPlans.length}`;
      // Like save_ai_plan(): one template per day, in the program.
      templatesState.list = [
        ...(templatesState.list as object[]),
        ...days.map((d, position) => ({
          id: `${id}-day-${position}`,
          owner_id: USER_ID,
          name: d.p_template.name,
          notes: null,
          program: null,
          position,
          is_hidden: false,
          created_at: '',
          updated_at: '',
          client_updated_at: null,
          program_id: id,
          exercises: [],
        })),
      ] as typeof templatesState.list;
      aiState.programs.push({
        id,
        name: program.name,
        description: '',
        weeks: program.weeks,
        notes: program.notes,
        created_at: '2026-11-01T10:00:00Z',
      });
      return id;
    },
  ),
  fetchPrograms: jest.fn(async () => aiState.programs.map((p) => ({ ...p }))),
  deleteProgram: jest.fn(async (id: string) => {
    aiState.programs = aiState.programs.filter((p) => p.id !== id);
    templatesState.list = (templatesState.list as { program_id?: string | null }[]).filter(
      (t) => t.program_id !== id,
    ) as typeof templatesState.list;
  }),
  fetchCoachMessages: jest.fn(async () => aiState.coach.map((m) => ({ ...m }))),
  sendCoachMessage: jest.fn(async (question: string, onText: (t: string) => void) => {
    const f = aiState.status.features.coach;
    if (aiState.coachError) {
      const e = aiState.coachError;
      aiState.coachError = null;
      throw new actualAi.AiError(e.code, e.message);
    }
    if (f.remaining <= 0)
      throw new actualAi.AiError(
        'limit',
        `You've used your ${f.limit} coach messages for today. You get new ones tomorrow.`,
      );
    f.used++;
    f.remaining--;
    let text = '';
    for (const piece of aiState.coachReply) {
      text += piece;
      onText(text);
      await Promise.resolve();
    }
    const n = aiState.coach.length;
    const saved: CoachRow[] = [
      { id: `c-${n + 1}`, role: 'user', content: question, created_at: `2026-11-01T10:00:0${n}Z` },
      {
        id: `c-${n + 2}`,
        role: 'assistant',
        content: text,
        created_at: `2026-11-01T10:00:0${n + 1}Z`,
      },
    ];
    aiState.coach.push(...saved);
    return saved;
  }),
  clearCoachChat: jest.fn(async () => {
    aiState.coach = [];
  }),
  generateWeeklyReportNow: jest.fn(async () => {
    const report = {
      id: 'rep-now',
      content: sampleReport,
      created_at: '',
      week_start: '2026-10-26',
      seen_at: null,
    };
    aiState.reports = [report, ...aiState.reports];
    return { report };
  }),
};

// --- Stage 8: points and leaderboards (computed on the server; faked here) -----
const level = (points: number, n = 1, name = 'Rookie I', min = 0, next: number | null = 100) => ({
  level: n,
  name,
  min_points: min,
  next_points: next,
  points,
});

export const pointsState = {
  me: { total: 64, week: 64, month: 64, level: level(64), under_review: 0 },
  boards: {} as Record<string, unknown>,
  workouts: new Map<string, unknown>(),
  ledger: [] as unknown[],
  settings: {
    workout_points: 50,
    min_working_sets: 3,
    set_points: 1,
    set_points_cap: 25,
    pr_points: 15,
    pr_cap: 3,
    daily_cap: 300,
    weekly_goal_points: 100,
    goal_min_days: 2,
    goal_max_days: 6,
    streak_points: 20,
    streak_cap_weeks: 5,
    level_base: 100,
    level_exponent: 1.6,
    flag_min_minutes: 10,
    flag_max_workouts_per_day: 3,
    flag_backdate_days: 7,
    flag_jump_pct: 30,
    flag_jump_min_kg: 15,
    flag_max_set_kg: 600,
    flag_default_bodyweight_kg: 100,
    weight_ratios: {},
    equipment_factors: {},
    timezone: 'Europe/Madrid',
    updated_at: '',
  },
  flagged: [] as {
    workout_id: string;
    status: string;
    reasons: unknown[];
    username: string;
    name: string;
    [k: string]: unknown;
  }[],
  users: [] as {
    user_id: string;
    username: string;
    leaderboard_banned: boolean;
    hidden: boolean;
    [k: string]: unknown;
  }[],
};

export const sampleBoard = (period = 'week') => ({
  period,
  week_start: '2026-11-02',
  month_start: '2026-11-01',
  refreshed_at: '2026-11-02T10:00:00Z',
  entries: [
    { rank: 1, username: 'anna', avatar_url: null, level: 4, points: 420, is_me: false },
    { rank: 2, username: 'gleb', avatar_url: null, level: 3, points: 310, is_me: true },
  ],
  me: {
    rank: 2,
    points: 310,
    level: 3,
    username: 'gleb',
    avatar_url: null,
    hidden: false,
    removed: false,
  },
});

export const sampleWorkoutPoints = (overrides: Record<string, unknown> = {}) => ({
  review: null,
  points: 69,
  items: [
    { reason: 'workout', points: 50, details: {} },
    { reason: 'sets', points: 4, details: { working_sets: 4 } },
    { reason: 'pr', points: 15, details: { exercises: ['Bench Press (Barbell)'] } },
  ],
  level_before: level(40),
  level_after: level(109, 2, 'Rookie II', 100, 303),
  ...overrides,
});

export function resetPoints() {
  pointsState.me = { total: 64, week: 64, month: 64, level: level(64), under_review: 0 };
  pointsState.boards = {
    week: sampleBoard('week'),
    month: sampleBoard('month'),
    all: sampleBoard('all'),
  };
  pointsState.workouts = new Map();
  pointsState.ledger = [
    {
      id: 2,
      points: 4,
      reason: 'sets',
      source_type: 'workout',
      source_id: 'w-1',
      workout_id: 'w-1',
      earned_at: '2026-11-02T10:00:00Z',
      day: '2026-11-02',
      details: { working_sets: 4 },
    },
    {
      id: 1,
      points: 50,
      reason: 'workout',
      source_type: 'workout',
      source_id: 'w-1',
      workout_id: 'w-1',
      earned_at: '2026-11-02T10:00:00Z',
      day: '2026-11-02',
      details: {},
    },
  ];
  pointsState.flagged = [
    {
      workout_id: 'w-flag',
      status: 'pending',
      reasons: [
        { reason: 'unrealistic_weight', exercise: 'Bicep Curl', weight_kg: 500, limit_kg: 66 },
      ],
      flagged_at: '',
      reviewed_at: null,
      user_id: 'user-2',
      username: 'anna',
      display_name: 'Anna',
      bodyweight_kg: 55,
      name: 'Arms',
      started_at: '2026-11-01T10:00:00Z',
      duration_seconds: 3000,
      logged_at: '',
      sets: [
        {
          exercise: 'Bicep Curl',
          set_type: 'normal',
          weight_kg: 500,
          reps: 8,
          duration_seconds: null,
          distance_m: null,
        },
      ],
    },
  ];
  pointsState.users = [
    {
      user_id: 'user-2',
      username: 'anna',
      display_name: 'Anna',
      email: 'anna@test.dev',
      avatar_url: null,
      points: 420,
      level: 4,
      self_hidden: false,
      leaderboard_banned: false,
      hidden: false,
      note: null,
      pending_flags: 1,
    },
  ];
}
resetPoints();

export const pointsMock = {
  fetchMyPoints: jest.fn(async () => ({ ...pointsState.me })),
  fetchPointsRules: jest.fn(async () => ({ ...pointsState.settings })),
  fetchLeaderboard: jest.fn(async (period: string) =>
    JSON.parse(JSON.stringify(pointsState.boards[period])),
  ),
  fetchWorkoutPoints: jest.fn(async (id: string) => pointsState.workouts.get(id) ?? null),
  fetchMyLedger: jest.fn(async () => [...pointsState.ledger]),
  fetchPointsSettings: jest.fn(async () => ({ ...pointsState.settings })),
  updatePointsSettings: jest.fn(async (changes: Partial<typeof pointsState.settings>) => {
    pointsState.settings = { ...pointsState.settings, ...changes };
    return { ...pointsState.settings };
  }),
  fetchFlaggedWorkouts: jest.fn(async (status: string) =>
    pointsState.flagged.filter((f) => status === 'all' || f.status === status),
  ),
  reviewWorkout: jest.fn(async (id: string, approve: boolean) => {
    const f = pointsState.flagged.find((x) => x.workout_id === id);
    if (f) f.status = approve ? 'approved' : 'rejected';
    return null;
  }),
  fetchAdminUsers: jest.fn(async () => pointsState.users.map((u) => ({ ...u }))),
  setUserModeration: jest.fn(
    async (id: string, m: { leaderboard_banned: boolean; hidden: boolean }) => {
      const u = pointsState.users.find((x) => x.user_id === id);
      if (u) Object.assign(u, m);
      return null;
    },
  ),
  fetchUserLedger: jest.fn(async () => [
    {
      points: 50,
      reason: 'workout',
      source_type: 'workout',
      source_id: 'w',
      workout: 'Push',
      earned_at: '',
      day: '2026-11-01',
      details: {},
    },
  ]),
};

// --- Stage 9: social (server logic faked; state in socialState) ---------------
const card = (user_id: string, username: string, level = 3) => ({
  user_id,
  username,
  avatar_url: null,
  level,
});

export const socialState = {
  people: [] as (ReturnType<typeof card> & { relation: string })[],
  friends: { friends: [], incoming: [], outgoing: [], blocked: [] } as {
    friends: ReturnType<typeof card>[];
    incoming: ReturnType<typeof card>[];
    outgoing: ReturnType<typeof card>[];
    blocked: { user_id: string; username: string }[];
  },
  feed: [] as {
    id: string;
    kind: string;
    occurred_at: string;
    is_mine: boolean;
    user: ReturnType<typeof card>;
    payload: Record<string, unknown>;
    reactions: Record<string, number>;
    my_reaction: string | null;
  }[],
  streak: { current: 3, longest: 5, this_week_done: false, this_week_sessions: 1, goal: 3 },
  badges: [] as Record<string, unknown>[],
  challenges: [] as Record<string, unknown>[],
  notifications: [] as {
    id: number;
    type: string;
    title: string;
    body: string;
    data: { url?: string };
    read_at: string | null;
    created_at: string;
  }[],
  privacy: { activity_visibility: 'friends', pr_show_weight: true },
  notificationSettings: {
    friend_request: true,
    friend_accepted: true,
    pr_beaten: true,
    challenge_invite: true,
    challenge_ending: true,
    streak_risk: true,
  } as Record<string, boolean>,
  reports: [] as Record<string, unknown>[],
  adminBadges: [] as Record<string, unknown>[],
  adminChallenges: [] as Record<string, unknown>[],
};

export const sampleChallenge = (overrides: Record<string, unknown> = {}) => ({
  id: 'ch-1',
  kind: 'friend',
  title: 'Bench-off',
  description: null,
  metric: 'workouts',
  exercise: null,
  exercise_id: null,
  goal: 4,
  start_date: '2026-11-02',
  end_date: '2026-11-08',
  ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  reward_points: 0,
  reward_badge: null,
  state: 'active',
  created_by: 'gleb',
  is_mine: true,
  my_status: 'joined',
  my_score: 2,
  participants: 2,
  ranking: [
    {
      ...card('user-2', 'anna', 4),
      rank: 1,
      score: 3,
      is_me: false,
      winner: false,
      status: 'joined',
    },
    { ...card(USER_ID, 'gleb'), rank: 2, score: 2, is_me: true, winner: false, status: 'joined' },
  ],
  ...overrides,
});

export function resetSocial() {
  socialState.people = [
    { ...card('user-2', 'anna', 4), relation: 'none' },
    { ...card('user-3', 'annabel', 2), relation: 'none' },
  ];
  socialState.friends = {
    friends: [],
    incoming: [card('user-4', 'marc')],
    outgoing: [],
    blocked: [],
  };
  socialState.feed = [
    {
      id: 'a-1',
      kind: 'pr',
      occurred_at: new Date(Date.now() - 3_600_000).toISOString(),
      is_mine: false,
      user: card('user-2', 'anna', 4),
      payload: { exercise: 'Bench Press (Barbell)', weight_kg: 57.5 },
      reactions: { '💪': 1 },
      my_reaction: null,
    },
    {
      id: 'a-2',
      kind: 'workout',
      occurred_at: new Date(Date.now() - 7_200_000).toISOString(),
      is_mine: false,
      user: card('user-2', 'anna', 4),
      payload: { name: 'Push', minutes: 52, sets: 14, exercises: 4 },
      reactions: {},
      my_reaction: null,
    },
  ];
  socialState.streak = {
    current: 3,
    longest: 5,
    this_week_done: false,
    this_week_sessions: 1,
    goal: 3,
  };
  socialState.badges = [
    {
      id: 'b-1',
      slug: 'first_workout',
      name: 'First rep',
      description: 'Finish your first workout.',
      icon: 'flag-outline',
      category: 'milestone',
      earned_at: '2026-10-05T18:00:00Z',
      progress: null,
    },
    {
      id: 'b-2',
      slug: 'workouts_10',
      name: 'Regular',
      description: 'Finish 10 workouts.',
      icon: 'barbell-outline',
      category: 'milestone',
      earned_at: null,
      progress: { current: 7, target: 10, earned_at: null },
    },
    {
      id: 'b-3',
      slug: 'bench_bw',
      name: 'Bench your bodyweight',
      description: 'Bench press your own bodyweight.',
      icon: 'fitness-outline',
      category: 'strength',
      earned_at: null,
      progress: { current: 70, target: 80, earned_at: null },
    },
  ];
  socialState.challenges = [
    sampleChallenge(),
    sampleChallenge({
      id: 'ch-2',
      kind: 'global',
      title: 'November workouts',
      is_mine: false,
      my_status: null,
      my_score: null,
      created_by: null,
      ranking: null,
    }),
    sampleChallenge({
      id: 'ch-3',
      title: 'Squat week',
      is_mine: false,
      my_status: 'invited',
      my_score: null,
      created_by: 'anna',
      ranking: null,
    }),
  ];
  socialState.notifications = [
    {
      id: 1,
      type: 'friend_request',
      title: 'New friend request',
      body: 'marc wants to be friends.',
      data: { url: '/friends' },
      read_at: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      type: 'challenge_invite',
      title: 'Challenge invite',
      body: 'anna invited you to “Squat week”.',
      data: { url: '/challenges/ch-3' },
      read_at: null,
      created_at: new Date().toISOString(),
    },
  ];
  socialState.privacy = { activity_visibility: 'friends', pr_show_weight: true };
  for (const k of Object.keys(socialState.notificationSettings))
    socialState.notificationSettings[k] = true;
  socialState.reports = [
    {
      id: 'r-1',
      reason: 'spam',
      note: 'Keeps sending requests',
      status: 'open',
      resolution: null,
      created_at: '2026-11-01T10:00:00Z',
      resolved_at: null,
      reporter: 'anna',
      reported: {
        ...card('user-5', 'spammy', 1),
        email: 'spam@test.dev',
        leaderboard_banned: false,
        banned: false,
        reports: 2,
      },
      activity: null,
    },
  ];
  socialState.adminBadges = [
    {
      id: 'b-1',
      slug: 'first_workout',
      name: 'First rep',
      description: 'Finish your first workout.',
      icon: 'flag-outline',
      category: 'milestone',
      rule_type: 'workout_count',
      rule: { count: 1 },
      position: 10,
      is_hidden: false,
      earned_by: 2,
    },
  ];
  socialState.adminChallenges = [
    sampleChallenge({
      id: 'ch-2',
      kind: 'global',
      title: 'November workouts',
      is_hidden: false,
      ranking: null,
    }),
  ];
}
resetSocial();

const relationAfter: Record<string, string> = {
  add: 'outgoing',
  accept: 'friends',
  decline: 'none',
  remove: 'none',
  block: 'blocked',
  unblock: 'none',
};
const setRelation = (userId: string, action: string) => {
  const p = socialState.people.find((x) => x.user_id === userId);
  if (p) p.relation = relationAfter[action]!;
};

export const socialMock = {
  ...jest.requireActual('@/lib/api/social'),
  searchUsers: jest.fn(async (q: string) =>
    socialState.people.filter((p) => p.username.includes(q)).map((p) => ({ ...p })),
  ),
  sendFriendRequest: jest.fn(async (id: string) => (setRelation(id, 'add'), 'outgoing')),
  respondFriendRequest: jest.fn(async (id: string, accept: boolean) => {
    const f = socialState.friends;
    const u = f.incoming.find((x) => x.user_id === id);
    f.incoming = f.incoming.filter((x) => x.user_id !== id);
    if (accept && u) f.friends.push(u);
    return accept ? 'friends' : 'none';
  }),
  removeFriend: jest.fn(async (id: string) => {
    socialState.friends.friends = socialState.friends.friends.filter((x) => x.user_id !== id);
    setRelation(id, 'remove');
    return 'none';
  }),
  blockUser: jest.fn(async (id: string) => (setRelation(id, 'block'), 'blocked')),
  unblockUser: jest.fn(async (id: string) => (setRelation(id, 'unblock'), 'none')),
  fetchFriends: jest.fn(async () => JSON.parse(JSON.stringify(socialState.friends))),
  fetchUserProfile: jest.fn(async (username: string) => {
    const p = socialState.people.find((x) => x.username === username) ?? {
      ...card('user-2', username),
      relation: 'none',
    };
    return {
      ...p,
      streak: { current: 2, longest: 4, this_week_done: true },
      badges: [{ name: 'First rep', icon: 'flag-outline', earned_at: '2026-10-05T18:00:00Z' }],
      activity:
        p.relation === 'friends'
          ? socialState.feed.filter((a) => a.user.username === username)
          : null,
      activity_hidden: false,
    };
  }),
  fetchMyStreak: jest.fn(async () => ({ ...socialState.streak })),
  fetchFeed: jest.fn(async () => JSON.parse(JSON.stringify(socialState.feed))),
  react: jest.fn(async (id: string, emoji: string | null) => {
    const a = socialState.feed.find((x) => x.id === id)!;
    if (a.my_reaction) a.reactions[a.my_reaction] = (a.reactions[a.my_reaction] ?? 1) - 1;
    if (a.my_reaction && !a.reactions[a.my_reaction]) delete a.reactions[a.my_reaction];
    a.my_reaction = emoji;
    if (emoji) a.reactions[emoji] = (a.reactions[emoji] ?? 0) + 1;
    return { ...a };
  }),
  fetchMyBadges: jest.fn(async () => JSON.parse(JSON.stringify(socialState.badges))),
  fetchFriendsLeaderboard: jest.fn(async (period: string) => ({
    period,
    refreshed_at: '',
    friends: socialState.friends.friends.length,
    entries: [
      { rank: 1, username: 'anna', avatar_url: null, level: 4, points: 400, is_me: false },
      { rank: 2, username: 'gleb', avatar_url: null, level: 3, points: 300, is_me: true },
    ],
  })),
  fetchChallenges: jest.fn(async () => JSON.parse(JSON.stringify(socialState.challenges))),
  fetchChallenge: jest.fn(async (id: string) =>
    JSON.parse(
      JSON.stringify(socialState.challenges.find((c) => c.id === id) ?? sampleChallenge({ id })),
    ),
  ),
  createFriendChallenge: jest.fn(async () => 'ch-new'),
  inviteToChallenge: jest.fn(async () => null),
  setChallengeStatus: jest.fn(async (id: string, status: string) => {
    const c = socialState.challenges.find((x) => x.id === id)!;
    c.my_status = status;
    return { ...c };
  }),
  reportUser: jest.fn(async () => null),
  fetchNotifications: jest.fn(async () => socialState.notifications.map((n) => ({ ...n }))),
  fetchUnreadCount: jest.fn(async () => socialState.notifications.filter((n) => !n.read_at).length),
  markNotificationsRead: jest.fn(async (ids?: number[]) => {
    for (const n of socialState.notifications)
      if (!ids || ids.includes(n.id)) n.read_at = new Date().toISOString();
    return null;
  }),
  fetchPrivacySettings: jest.fn(async () => ({ ...socialState.privacy })),
  savePrivacySettings: jest.fn(
    async (_u: string, v: typeof socialState.privacy) => ((socialState.privacy = { ...v }), v),
  ),
  fetchNotificationSettings: jest.fn(async () => ({ ...socialState.notificationSettings })),
  saveNotificationSettings: jest.fn(
    async (_u: string, v: Record<string, boolean>) => (
      (socialState.notificationSettings = { ...v }),
      v
    ),
  ),
  fetchAdminBadges: jest.fn(async () => JSON.parse(JSON.stringify(socialState.adminBadges))),
  saveBadge: jest.fn(async () => 'b-new'),
  setBadgeHidden: jest.fn(async (id: string, hidden: boolean) => {
    const b = socialState.adminBadges.find((x) => x.id === id);
    if (b) b.is_hidden = hidden;
    return null;
  }),
  fetchAdminChallenges: jest.fn(async () =>
    JSON.parse(JSON.stringify(socialState.adminChallenges)),
  ),
  saveChallenge: jest.fn(async () => 'ch-new'),
  setChallengeHidden: jest.fn(async () => null),
  fetchReports: jest.fn(async (status: string) =>
    socialState.reports.filter((r) => status === 'all' || r.status === status),
  ),
  resolveReport: jest.fn(async (id: string, action: string) => {
    const r = socialState.reports.find((x) => x.id === id)!;
    r.status = action === 'dismiss' ? 'dismissed' : 'actioned';
    r.resolution = action;
    return null;
  }),
  setUserBanned: jest.fn(async () => null),
};
