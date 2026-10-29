import { router, Stack } from 'expo-router';

import { EmptyState, Screen } from '@/components/ui';

export default function NotFoundScreen() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Not found' }} />
      <EmptyState
        icon="help-circle-outline"
        title="Page not found"
        message="This screen doesn't exist."
        actionLabel="Go home"
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}
