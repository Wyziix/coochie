import { ThemeToggle } from '@/components/ThemeToggle';
import { Card, Header, Screen, Text } from '@/components/ui';
import { isSupabaseConfigured } from '@/lib/env';

export default function ProfileScreen() {
  return (
    <Screen scroll header={<Header title="Profile" />}>
      <Card>
        <Text variant="heading">Appearance</Text>
        <ThemeToggle />
      </Card>
      <Card>
        <Text variant="heading">Backend</Text>
        <Text color={isSupabaseConfigured ? 'success' : 'warning'}>
          {isSupabaseConfigured
            ? 'Supabase configured'
            : 'Supabase keys missing (see .env.example)'}
        </Text>
      </Card>
    </Screen>
  );
}
