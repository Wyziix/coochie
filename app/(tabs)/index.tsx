import { Card, EmptyState, Header, Screen, Text } from '@/components/ui';

export default function HomeScreen() {
  return (
    <Screen scroll header={<Header title="Home" subtitle="Your week at a glance" />}>
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
