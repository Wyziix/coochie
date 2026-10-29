import { Redirect, Stack } from 'expo-router';

import { OnlineOnly } from '@/components/offline/NeedsConnection';
import { useIsAdmin } from '@/hooks/useIsAdmin';

// Client-side gate is cosmetic; the server re-checks is_admin() on every call.
export default function AdminLayout() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) return <Redirect href="/" />;

  return (
    <OnlineOnly message="Admin tools change data for everyone, so they need a connection.">
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="exercises" options={{ title: 'Exercise library' }} />
        <Stack.Screen name="exercise" options={{ title: 'Exercise' }} />
        <Stack.Screen name="templates" options={{ title: 'Ready-made templates' }} />
        <Stack.Screen name="template" options={{ title: 'Template' }} />
        <Stack.Screen name="ai" options={{ title: 'AI' }} />
      </Stack>
    </OnlineOnly>
  );
}
