import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { PhotoLockWatcher } from '@/components/photos/PhotoLockWatcher';
import { AppFrame } from '@/components/providers/AppFrame';
import { AppProviders } from '@/components/providers/AppProviders';
import { Button, ErrorState, LoadingState, Screen } from '@/components/ui';
import { RestTimerWatcher } from '@/components/workout/RestTimerWatcher';
import { useAuthListener } from '@/hooks/useAuthListener';
import { useProfile } from '@/hooks/useProfile';
import { useThemeHydrated } from '@/hooks/useThemeHydrated';
import { signOut } from '@/lib/auth';
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

function RootNavigator() {
  useAuthListener();
  const status = useAuthStore((s) => s.status);
  const profile = useProfile();

  const signedIn = status === 'signedIn';
  const onboarded = !!profile.data?.onboarding_completed_at;
  const ready = status !== 'loading' && (!signedIn || !profile.isPending);

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
        </Stack.Protected>
      </Stack>
    </>
  );
}
