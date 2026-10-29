import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { draftFromTemplate } from '@/lib/templates/draft';
import type { Template } from '@/lib/api/templates';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';
import { useEditWorkoutStore, useWorkoutStore } from '@/stores/workoutStore';
import {
  exercisesState,
  fakeProfile,
  fakeSession,
  onboardedProfile,
  resetBackend,
  templatesState,
} from '@/test-utils/backend';

jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
jest.mock('@/lib/supabase', () => require('@/test-utils/backend').supabaseMock);
jest.mock('@/lib/api/profiles', () => require('@/test-utils/backend').profilesMock);
jest.mock('@/lib/api/progress', () => require('@/test-utils/backend').progressMock);
jest.mock('@/lib/api/body', () => require('@/test-utils/backend').bodyMock);
jest.mock('@/lib/api/photos', () => require('@/test-utils/backend').photosMock);
jest.mock('@/lib/api/photoLock', () => ({
  ...jest.requireActual('@/lib/api/photoLock'),
  ...require('@/test-utils/backend').photoLockMock,
}));
jest.mock('@/lib/photos/biometrics', () => require('@/test-utils/backend').biometricsMock);
jest.mock('@/lib/api/templates', () => require('@/test-utils/backend').templatesMock);
jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);
jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);

// Opens every screen so the global checks in jest.after-env.ts (no nested
// pressables) run on all of them, not just the ones other tests visit.
const appDir = path.resolve(__dirname, '../app');

const signedInRoutes = [
  '/',
  '/workout',
  '/progress',
  '/ranking',
  '/profile',
  '/admin',
  '/admin/exercises',
  '/admin/exercise',
  '/admin/exercise?id=ex-squat',
  '/edit-profile',
  '/workouts/active',
  '/workouts/plates?weight=100',
  '/workouts/w-1',
  '/exercises/pick',
  '/exercises/new',
  '/exercises/ex-bench',
  '/history',
  '/templates/tpl-push',
  '/templates/tpl-mine',
  '/templates/edit',
  '/workouts/edit',
  '/admin/templates',
  '/admin/template?id=tpl-push',
  '/exercises/ex-bench?tab=progress',
  '/body',
  '/photos',
  '/photo-lock',
  '/photos/compare?a=p-1&b=p-2',
  '/workouts/celebrate?id=w-1',
];

describe('every screen renders', () => {
  beforeEach(() => {
    useWorkoutStore.setState({ workout: null, restTimer: null });
    useWorkoutStore.getState().start('Smoke', 'kg');
    useWorkoutStore.getState().addExercises(exercisesState.list.slice(0, 3), () => 90);
    useWorkoutStore
      .getState()
      .startRest(useWorkoutStore.getState().workout!.exercises[0]!.key, 60, null);
  });

  it.each(signedInRoutes)('%s', async (url) => {
    resetBackend({ session: fakeSession(), profile: onboardedProfile({ role: 'admin' }) });
    await renderRouter(appDir, { initialUrl: url });
    await waitFor(() => expect(screen).toHavePathname(url.split('?')[0]!));
    await screen.findAllByText(/./);
  });

  it('/sign-in', async () => {
    resetBackend();
    await renderRouter(appDir, { initialUrl: '/sign-in' });
    expect(await screen.findByText('Continue with Google')).toBeOnTheScreen();
  });

  it('/onboarding', async () => {
    resetBackend({ session: fakeSession(), profile: fakeProfile() });
    await renderRouter(appDir, { initialUrl: '/onboarding' });
    expect(await screen.findByText('Pick a username')).toBeOnTheScreen();
  });
});
