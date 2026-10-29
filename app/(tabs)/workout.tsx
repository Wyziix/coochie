import { EmptyState, Header, Screen } from '@/components/ui';

export default function WorkoutScreen() {
  return (
    <Screen header={<Header title="Workout" />}>
      <EmptyState
        icon="barbell-outline"
        title="No active workout"
        message="Workout logging comes in Stage 2."
      />
    </Screen>
  );
}
