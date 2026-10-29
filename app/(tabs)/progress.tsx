import { EmptyState, Header, Screen } from '@/components/ui';

export default function ProgressScreen() {
  return (
    <Screen header={<Header title="Progress" />}>
      <EmptyState
        icon="stats-chart-outline"
        title="Nothing to show yet"
        message="Charts and personal records will appear after your first workouts."
      />
    </Screen>
  );
}
