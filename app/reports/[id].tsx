import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';

import { FeedbackList, SeeProfessional } from '@/components/ai/FeedbackSections';
import { Card, ErrorState, LoadingState, Text } from '@/components/ui';
import { useMarkReportSeen, useWeeklyReports } from '@/hooks/useAi';
import { useTheme } from '@/hooks/useTheme';
import { weekLabel } from '@/lib/ai/format';

export default function ReportScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isPending, error, refetch } = useWeeklyReports();
  const seen = useMarkReportSeen();
  const report = data?.find((r) => r.id === id);

  const unseen = report && !report.seen_at;
  useEffect(() => {
    if (unseen) seen.mutate(id);
    // Mark once when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen, id]);

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!report) return <ErrorState title="Report not found" />;
  const c = report.content;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <Stack.Screen options={{ title: weekLabel(report.week_start) }} />
      <Text>{c.summary}</Text>
      {c.see_professional ? <SeeProfessional /> : null}
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="label" color="textMuted">
              Consistency
            </Text>
            <Text>{c.consistency}</Text>
          </View>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="label" color="textMuted">
              Volume
            </Text>
            <Text>{c.volume_trend}</Text>
          </View>
          <FeedbackList title="Highlights" items={c.highlights} color="success" />
          <FeedbackList title="Watch out" items={c.warnings} color="danger" />
          <FeedbackList title="Focus next week" items={c.focus_next_week} />
        </View>
      </Card>
      <Text variant="caption" color="textMuted">
        Written by AI from your logged workouts. Not medical advice.
      </Text>
    </ScrollView>
  );
}
