import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import { useWeeklyReports } from '@/hooks/useAi';
import { useTheme } from '@/hooks/useTheme';
import { weekLabel } from '@/lib/ai/format';
import { askForPush, pushAllowed, supportsPush } from '@/lib/platform/push';

/** Weekly AI reports, newest first. They're written every Monday for weeks you trained. */
export default function ReportsScreen() {
  const theme = useTheme();
  const { data, isPending, error, refetch } = useWeeklyReports();
  const [push, setPush] = useState<boolean | null>(null);

  useEffect(() => {
    pushAllowed().then(setPush);
  }, []);

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <Text color="textMuted">
        Every Monday you get a short report on the week before, if you trained.
      </Text>
      {supportsPush && push === false ? (
        <Button
          title="Notify me when a report is ready"
          variant="secondary"
          onPress={() => askForPush().then(setPush)}
        />
      ) : null}
      {data.length === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title="No reports yet"
          message="Your first one arrives on the Monday after a week with workouts."
        />
      ) : (
        data.map((r) => (
          <Card
            key={r.id}
            onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })}
            accessibilityLabel={`${weekLabel(r.week_start)}${r.seen_at ? '' : ', new'}`}
          >
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label">
                {weekLabel(r.week_start)}
                {r.seen_at ? '' : ' · New'}
              </Text>
              <Text variant="caption" color="textMuted" numberOfLines={2}>
                {r.content.summary}
              </Text>
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
