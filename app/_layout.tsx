import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { SyncWatcher } from '@/components/offline/SyncWatcher';
import { PhotoLockWatcher } from '@/components/photos/PhotoLockWatcher';
import { AppFrame } from '@/components/providers/AppFrame';
import { AppProviders } from '@/components/providers/AppProviders';
import { Button, ErrorState, LoadingState, Screen } from '@/components/ui';
import { RestTimerWatcher } from '@/components/workout/RestTimerWatcher';
import { useAuthListener } from '@/hooks/useAuthListener';
import { useProfile } from '@/hooks/useProfile';
import { useThemeHydrated } from '@/hooks/useThemeHydrated';
import { signOut } from '@/lib/auth';
import { startQueryPersistence } from '@/lib/offline/cache';
import { loadOutbox } from '@/lib/offline/outbox';
import { useAuthStore } from '@/stores/authStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const hydrated = useThemeHydrated();
  if (!hydrated) return null;

  return (
    <AppProviders>
      <AppFrame>
        <RootNavigator />
      </AppFrame>
      <RestTimerWatcher />
    </AppProviders>
  );
}

/**
 * Brings back this user's cached data (so the app works offline) and their
 * sync queue. Returns false until the cache is restored.
 */
function useOfflineData(userId: string | null) {
  const queryClient = useQueryClient();
  const [restoredFor, setRestoredFor] = useState<string | null>(null);

  useEffect(() => {
    loadOutbox(userId);
    if (!userId) return;
    const [stop, restored] = startQueryPersistence(queryClient, userId);
    restored.finally(() => setRestoredFor(userId));
    return stop;
  }, [userId, queryClient]);

  return !userId || restoredFor === userId;
}

function RootNavigator() {
  useAuthListener();
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const restored = useOfflineData(userId);
  const profile = useProfile();

  const signedIn = status === 'signedIn';
  const onboarded = !!profile.data?.onboarding_completed_at;
  const ready = status !== 'loading' && restored && (!signedIn || !profile.isPending);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return <LoadingState />;

  if (signedIn && profile.isError) {
    return (
      <Screen>
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
        <Button title="Log out" variant="ghost" onPress={() => signOut().catch(() => {})} />
      </Screen>
    );
  }

  return (
    <>
      {signedIn ? <PhotoLockWatcher /> : null}
      {signedIn ? <SyncWatcher /> : null}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>

        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>

        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="edit-profile"
            options={{ headerShown: true, title: 'Edit profile', presentation: 'modal' }}
          />
          <Stack.Screen name="workouts/active" options={{ gestureEnabled: false }} />
          <Stack.Screen name="workouts/[id]" options={{ headerShown: true, title: 'Workout' }} />
          <Stack.Screen
            name="workouts/plates"
            options={{ headerShown: true, title: 'Plate calculator', presentation: 'modal' }}
          />
          <Stack.Screen
            name="exercises/pick"
            options={{ headerShown: true, title: 'Add exercises', presentation: 'modal' }}
          />
          <Stack.Screen
            name="exercises/new"
            options={{ headerShown: true, title: 'New exercise' }}
          />
          <Stack.Screen name="exercises/[id]" options={{ headerShown: true, title: 'Exercise' }} />
          <Stack.Screen
            name="workouts/edit"
            options={{ headerShown: true, title: 'Edit workout' }}
          />
          <Stack.Screen name="workouts/celebrate" options={{ gestureEnabled: false }} />
          <Stack.Screen name="body" options={{ headerShown: true, title: 'Body' }} />
          <Stack.Screen
            name="photos/index"
            options={{ headerShown: true, title: 'Progress photos' }}
          />
          <Stack.Screen name="photos/compare" options={{ headerShown: true, title: 'Compare' }} />
          <Stack.Screen name="templates/[id]" options={{ headerShown: true, title: 'Template' }} />
          <Stack.Screen name="templates/edit" options={{ headerShown: true, title: 'Template' }} />
          <Stack.Screen name="history" options={{ headerShown: true, title: 'History' }} />
          <Stack.Screen name="photo-lock" options={{ headerShown: true, title: 'Photo lock' }} />
          <Stack.Screen name="sync" options={{ headerShown: true, title: 'Sync' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
