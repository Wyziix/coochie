import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import { useWeeklyReports } from '@/hooks/useAi';
import { useTheme } from '@/hooks/useTheme';
import { weekLabel } from '@/lib/ai/format';
import { pushState, type PushState } from '@/lib/platform/push';

/** Weekly AI reports, newest first. They're written every Monday for weeks you trained. */
export default function ReportsScreen() {
  const theme = useTheme();
  const { data, isPending, error, refetch } = useWeeklyReports();
  const [push, setPush] = useState<PushState | null>(null);

  useEffect(() => {
    pushState()
      .then(setPush)
      .catch(() => setPush('unsupported'));
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
      {push === 'off' || push === 'needs_install' ? (
        <Button
          title="Notify me when a report is ready"
          variant="secondary"
          onPress={() => router.push('/settings')}
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
