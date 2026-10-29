import { Card, EmptyState, Header, Screen, Text } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';

export default function HomeScreen() {
  const { data: profile } = useProfile();
  const name = profile?.display_name?.split(' ')[0] || profile?.username;

  return (
    <Screen
      scroll
      header={<Header title={name ? `Hi, ${name}` : 'Home'} subtitle="Your week at a glance" />}
    >
      <Card>
        <Text variant="heading">This week</Text>
        <Text color="textMuted">Workouts, volume and muscle groups will show here.</Text>
      </Card>
      <EmptyState
        icon="barbell-outline"
        title="No workouts yet"
        message="Start one from the Workout tab."
      />
    </Screen>
  );
}
