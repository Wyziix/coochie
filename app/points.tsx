import { ScrollView, View } from 'react-native';

import { LevelCard } from '@/components/points/LevelCard';
import { Card, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import { useMyLedger, usePointsRules } from '@/hooks/usePoints';
import { useTheme } from '@/hooks/useTheme';
import { describeItem, signed } from '@/lib/points/labels';

/** Where my points came from, newest first. */
export default function PointsScreen() {
  const theme = useTheme();
  const ledger = useMyLedger();
  const rules = usePointsRules().data;

  if (ledger.isPending) return <LoadingState />;
  if (ledger.error && !ledger.data)
    return <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} />;

  const days: { day: string; rows: NonNullable<typeof ledger.data> }[] = [];
  for (const row of ledger.data ?? []) {
    const last = days.at(-1);
    if (last?.day === row.day) last.rows.push(row);
    else days.push({ day: row.day, rows: [row] });
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <LevelCard />
      {rules ? (
        <Card>
          <Text variant="label">How points work</Text>
          <Text variant="caption" color="textMuted">
            {`A workout with at least ${rules.min_working_sets} working sets: ${rules.workout_points} points, plus ${rules.set_points} per working set (up to ${rules.set_points_cap}). A new best weight on an exercise: ${rules.pr_points} (up to ${rules.pr_cap} per workout). Training your planned days in a week (${rules.goal_min_days} to ${rules.goal_max_days}): ${rules.weekly_goal_points}, plus ${rules.streak_points} for each week in a row (up to ${rules.streak_points * rules.streak_cap_weeks}). At most ${rules.daily_cap} a day. The same for everyone, whatever weights you lift.`}
          </Text>
        </Card>
      ) : null}
      {days.length === 0 ? (
        <EmptyState
          icon="star-outline"
          title="No points yet"
          message="Finish a workout to earn your first points."
        />
      ) : (
        days.map((d) => (
          <Card key={d.day}>
            <Text variant="label">
              {new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </Text>
            {d.rows.map((r) => (
              <View key={r.id} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
                  {describeItem(r)}
                </Text>
                <Text variant="caption" color={r.points < 0 ? 'danger' : 'text'}>
                  {signed(r.points)}
                </Text>
              </View>
            ))}
          </Card>
        ))
      )}
    </ScrollView>
  );
}
