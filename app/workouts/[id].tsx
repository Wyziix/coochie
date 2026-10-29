import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, ErrorState, LoadingState, Text } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { useWorkout } from '@/hooks/useWorkouts';
import type { WorkoutDetail } from '@/lib/api/workouts';
import { setTypeLabels } from '@/lib/exercises/labels';
import { formatWeight, toDisplayWeight, type WeightUnit } from '@/lib/units';
import { formatDuration, formatDurationShort, metersToDisplay } from '@/lib/workout/format';

type SetRowData = WorkoutDetail['sets'][number];

function describeSet(s: SetRowData, unit: WeightUnit): string {
  const parts: string[] = [];
  if (s.reps != null) {
    parts.push(
      s.weight_kg != null && s.weight_kg > 0
        ? `${toDisplayWeight(s.weight_kg, unit)} ${unit} × ${s.reps}`
        : `${s.reps} reps`,
    );
  }
  if (s.duration_seconds != null) parts.push(formatDuration(s.duration_seconds));
  if (s.distance_m != null)
    parts.push(`${metersToDisplay(s.distance_m, unit)} ${unit === 'lbs' ? 'mi' : 'km'}`);
  if (s.rpe != null) parts.push(`RPE ${s.rpe}`);
  return parts.join(' · ');
}

export default function WorkoutSummaryScreen() {
  const theme = useTheme();
  const { id, finished } = useLocalSearchParams<{ id: string; finished?: string }>();
  const { data: workout, isPending, error, refetch } = useWorkout(id);
  const unit = useProfile().data?.units ?? 'kg';

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!workout) return <ErrorState title="Workout not found" message="It may have been deleted." />;

  // Group sets by exercise block, keeping order.
  const blocks: { name: string; sets: SetRowData[] }[] = [];
  for (const s of workout.sets) {
    const last = blocks.at(-1);
    if (last && last.sets[0]!.exercise_order === s.exercise_order) last.sets.push(s);
    else blocks.push({ name: s.exercise.name, sets: [s] });
  }

  const stat = (label: string, value: string) => (
    <View style={styles.stat}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Stack.Screen options={{ title: finished ? 'Workout saved' : workout.name }} />
      <View style={{ gap: theme.spacing.xs }}>
        {finished ? (
          <Text variant="label" color="success">
            Nice work. Saved.
          </Text>
        ) : null}
        <Text variant="title">{workout.name}</Text>
        <Text color="textMuted">
          {new Date(workout.started_at).toLocaleString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>

      <Card style={styles.stats}>
        {stat('Duration', formatDurationShort(workout.duration_seconds))}
        {stat('Volume', formatWeight(workout.total_volume_kg, unit))}
        {stat('Sets', String(workout.sets.length))}
      </Card>

      {blocks.map((block, i) => (
        <Card key={`${block.name}-${i}`}>
          <Text variant="heading">{block.name}</Text>
          {block.sets.map((s, j) => (
            <View key={s.id} style={styles.setLine}>
              <Text color="textMuted" style={styles.setNo}>
                {setTypeLabels[s.set_type].short || j + 1}
              </Text>
              <Text>{describeSet(s, unit)}</Text>
            </View>
          ))}
        </Card>
      ))}

      {finished ? (
        <Button title="Done" onPress={() => router.replace('/workout')} fullWidth />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  setLine: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  setNo: { width: 20 },
});
