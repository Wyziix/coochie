import { EmptyState, Header, Screen } from '@/components/ui';

export default function RankingScreen() {
  return (
    <Screen header={<Header title="Ranking" />}>
      <EmptyState
        icon="trophy-outline"
        title="Leaderboards coming soon"
        message="Earn points by training consistently."
      />
    </Screen>
  );
}
