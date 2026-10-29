import { Redirect, Stack } from 'expo-router';

import { useIsAdmin } from '@/hooks/useIsAdmin';

// Client-side gate is cosmetic; the server re-checks is_admin() on every call.
export default function AdminLayout() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) return <Redirect href="/" />;

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="exercises" options={{ title: 'Exercise library' }} />
      <Stack.Screen name="exercise" options={{ title: 'Exercise' }} />
    </Stack>
  );
}
