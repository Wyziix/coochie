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

export const workoutsMock = {
  saveWorkout: jest.fn(async (payload: { p_workout: { id: string; name: string } }) => ({
    id: payload.p_workout.id,
    name: payload.p_workout.name,
  })),
  fetchRecentWorkouts: jest.fn(async () => []),
  fetchWorkout: jest.fn(async (id: string) => ({
    id,
    user_id: USER_ID,
    name: 'Saved workout',
    started_at: '2026-10-30T10:00:00Z',
    ended_at: '2026-10-30T11:00:00Z',
    duration_seconds: 3600,
    total_volume_kg: 400,
    notes: null,
    created_at: '',
    updated_at: '',
    sets: [],
  })),
};
