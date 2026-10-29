import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AppProviders } from '@/components/providers/AppProviders';
import { Button, ErrorState, LoadingState, Screen } from '@/components/ui';
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
      <RootNavigator />
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
        <ErrorState message="Couldn’t load your profile." onRetry={() => profile.refetch()} />
        <Button title="Log out" variant="ghost" onPress={() => signOut().catch(() => {})} />
      </Screen>
    );
  }

  return (
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
      </Stack.Protected>
    </Stack>
  );
}
