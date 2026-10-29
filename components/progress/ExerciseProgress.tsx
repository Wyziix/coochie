import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LineChartCard } from '@/components/charts/LineChartCard';
import {
  Card,
  ChipRow,
  Chip,
  ErrorState,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useExerciseHistory, useExerciseRecords } from '@/hooks/useProgress';
import { useTheme } from '@/hooks/useTheme';
import type { Exercise } from '@/lib/api/exercises';
import {
  formatRecordSet,
  formatRecordValue,
  recordLabels,
  recordTypesFor,
} from '@/lib/progress/records';
import {
  exerciseSeries,
  metricLabels,
  RANGES,
  type Metric,
  type Range,
} from '@/lib/progress/series';
import { formatDuration } from '@/lib/workout/format';

const metricsFor = (type: Exercise['type']): Metric[] =>
  type === 'weights'
    ? ['weight', 'e1rm', 'volume']
    : type === 'bodyweight'
      ? ['reps', 'volume']
      : ['duration'];

/** Records + charts for one exercise. */
export function ExerciseProgress({ exercise }: { exercise: Exercise }) {
  const theme = useTheme();
  const unit = useProfile().data?.units ?? 'kg';
  const metrics = metricsFor(exercise.type);
  const [metric, setMetric] = useState<Metric>(metrics[0]!);
  const [range, setRange] = useState<Range>('3M');
  const records = useExerciseRecords(exercise.id);
  const history = useExerciseHistory(exercise.id, range);

  const shownTypes = recordTypesFor(exercise.type);
  const best = (records.data ?? []).filter(
    (r) => shownTypes.includes(r.record_type) && r.record_type !== 'reps_at_weight',
  );
  const repRecords = (records.data ?? [])
    .filter((r) => r.record_type === 'reps_at_weight')
    .sort((a, b) => b.bucket_kg - a.bucket_kg)
    .slice(0, 6);

  const points = exerciseSeries(history.data ?? [], metric, unit);
  const format = (v: number) =>
    metric === 'duration' ? formatDuration(v) : metric === 'reps' ? `${v} reps` : `${v} ${unit}`;

  if (records.error) return <ErrorState error={records.error} onRetry={() => records.refetch()} />;

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="heading">Personal records</Text>
      {records.isPending ? (
        <LoadingState />
      ) : best.length === 0 && repRecords.length === 0 ? (
        <Text color="textMuted">Log this exercise to start tracking records.</Text>
      ) : (
        <View style={[styles.grid, { gap: theme.spacing.sm }]}>
          {best.map((r) => (
            <Card key={r.record_type} style={styles.cell}>
              <Text variant="caption" color="textMuted">
                {recordLabels[r.record_type]}
              </Text>
              <Text variant="heading">{formatRecordValue(r, unit)}</Text>
              <Text variant="caption" color="textMuted">
                {[formatRecordSet(r, unit), new Date(r.achieved_at).toLocaleDateString()]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Card>
          ))}
        </View>
      )}
      {repRecords.length > 0 ? (
        <Card>
          <Text variant="label">Most reps by weight</Text>
          {repRecords.map((r) => (
            <View key={r.bucket_kg} style={styles.row}>
              <Text color="textMuted" style={styles.flex}>
                {r.bucket_kg > 0
                  ? formatRecordValue({ ...r, record_type: 'heaviest_weight' }, unit, r.bucket_kg)
                  : 'Bodyweight'}
              </Text>
              <Text variant="label">{r.value} reps</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Text variant="heading">Progress</Text>
      {metrics.length > 1 ? (
        <SegmentedControl
          accessibilityLabel="Chart"
          options={metrics.map((m) => ({ value: m, label: metricLabels[m] }))}
          value={metric}
          onChange={setMetric}
        />
      ) : null}
      <ChipRow accessibilityLabel="Time range">
        {RANGES.map((r) => (
          <Chip
            key={r}
            label={r}
            selected={range === r}
            accessibilityRole="radio"
            onPress={() => setRange(r)}
          />
        ))}
      </ChipRow>
      {history.error ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      ) : history.isPending ? (
        <LoadingState />
      ) : (
        <LineChartCard
          points={points}
          format={format}
          formatAxis={(v) => (metric === 'duration' ? formatDuration(v) : String(Math.round(v)))}
          emptyText={`No ${exercise.name} sessions in this range.`}
        />
      )}
      {history.data?.length ? (
        <Card>
          <Text variant="label">Sessions</Text>
          {[...history.data]
            .reverse()
            .slice(0, 8)
            .map((h) => (
              <Text
                key={h.workout_id}
                color="primary"
                accessibilityRole="link"
                onPress={() =>
                  router.push({ pathname: '/workouts/[id]', params: { id: h.workout_id } })
                }
                style={{ paddingVertical: 6 }}
              >
                {new Date(h.started_at).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {h.max_weight_kg
                  ? ` · top ${formatRecordValue({ record_type: 'heaviest_weight', value: h.max_weight_kg, weight_kg: null, reps: null }, unit)}`
                  : ''}
                {h.total_reps ? ` · ${h.total_reps} reps` : ''}
              </Text>
            ))}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexGrow: 1, flexBasis: 160, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  flex: { flex: 1 },
});
