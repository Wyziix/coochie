import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, Header, Screen, Text } from '@/components/ui';
import { useMeasurements } from '@/hooks/useBody';
import { usePhotos } from '@/hooks/usePhotos';
import { useProfile } from '@/hooks/useProfile';
import { useRecentRecords, useTrainedExercises } from '@/hooks/useProgress';
import { useTheme } from '@/hooks/useTheme';
import { muscleLabels } from '@/lib/exercises/labels';
import { latest } from '@/lib/progress/measurements';
import { formatRecordValue, recordLabels } from '@/lib/progress/records';
import { bodyValue, shortDate } from '@/lib/progress/series';

export default function ProgressScreen() {
  const theme = useTheme();
  const unit = useProfile().data?.units ?? 'kg';
  const body = useMeasurements();
  const photos = usePhotos();
  const records = useRecentRecords(8);
  const exercises = useTrainedExercises();
  const [now] = useState(() => Date.now());

  const bw = latest(body.data ?? [], 'bodyweight_kg');
  const monthAgo = (body.data ?? []).find(
    (m) => m.bodyweight_kg != null && Date.parse(m.measured_on) <= now - 28 * 86400e3,
  );
  const bwChange =
    bw != null && monthAgo?.bodyweight_kg != null
      ? Math.round(
          (bodyValue(bw, 'weight', unit) - bodyValue(monthAgo.bodyweight_kg, 'weight', unit)) * 10,
        ) / 10
      : null;
  const openExercise = (id: string) =>
    router.push({ pathname: '/exercises/[id]', params: { id, tab: 'progress' } });

  return (
    <Screen scroll header={<Header title="Progress" />}>
      <View style={[styles.pair, { gap: theme.spacing.md }]}>
        <Card
          onPress={() => router.push('/body')}
          accessibilityLabel="Body stats"
          style={styles.flex}
        >
          <Text variant="caption" color="textMuted">
            Bodyweight
          </Text>
          <Text variant="heading">
            {bw != null ? `${bodyValue(bw, 'weight', unit)} ${unit}` : '–'}
          </Text>
          <Text variant="caption" color="textMuted">
            {bwChange != null
              ? `${bwChange > 0 ? '+' : ''}${bwChange} ${unit} in 4 weeks`
              : 'Tap to log'}
          </Text>
        </Card>
        <Card
          onPress={() => router.push('/photos')}
          accessibilityLabel="Progress photos"
          style={styles.flex}
        >
          <Text variant="caption" color="textMuted">
            Photos
          </Text>
          <View style={[styles.thumbs, { gap: 4 }]}>
            {(photos.data ?? [])
              .slice(0, 3)
              .map((p) =>
                p.url ? (
                  <Image
                    key={p.id}
                    source={{ uri: p.url }}
                    style={[styles.thumb, { borderRadius: theme.radius.sm }]}
                    contentFit="cover"
                  />
                ) : null,
              )}
          </View>
          <Text variant="caption" color="textMuted">
            {photos.data?.length
              ? `${photos.data.length} photo${photos.data.length === 1 ? '' : 's'}`
              : 'Tap to add'}
          </Text>
        </Card>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="heading">Recent records</Text>
        {records.error ? (
          <ErrorState error={records.error} onRetry={() => records.refetch()} />
        ) : records.data?.length ? (
          records.data.map((r) => (
            <Card
              key={r.id}
              onPress={() => openExercise(r.exercise_id)}
              accessibilityLabel={`${r.exercise.name} ${recordLabels[r.record_type]}`}
            >
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text variant="label">{r.exercise.name}</Text>
                  <Text variant="caption" color="textMuted">
                    {recordLabels[r.record_type]} · {shortDate(r.achieved_at)}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text variant="label" color="success">
                    {formatRecordValue(r, unit)}
                  </Text>
                  {r.previous_value != null ? (
                    <Text variant="caption" color="textMuted">
                      was {formatRecordValue(r, unit, r.previous_value)}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Card>
          ))
        ) : records.isPending ? null : (
          <Text color="textMuted">Beat a previous best and it shows up here.</Text>
        )}
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="heading">Exercises</Text>
        {exercises.error ? (
          <ErrorState error={exercises.error} onRetry={() => exercises.refetch()} />
        ) : exercises.data?.length ? (
          exercises.data.map((e) => (
            <Card
              key={e.exercise_id}
              onPress={() => openExercise(e.exercise_id)}
              accessibilityLabel={`${e.name} progress`}
            >
              <Text variant="label">{e.name}</Text>
              <Text variant="caption" color="textMuted">
                {muscleLabels[e.primary_muscle]} · {e.sessions} session{e.sessions === 1 ? '' : 's'}{' '}
                · last {shortDate(e.last_performed)}
              </Text>
            </Card>
          ))
        ) : exercises.isPending ? null : (
          <EmptyState
            icon="stats-chart-outline"
            title="Nothing to chart yet"
            message="Finish a workout and your exercises show up here."
          />
        )}
      </View>

      <Button title="Workout history" variant="ghost" onPress={() => router.push('/history')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  right: { alignItems: 'flex-end' },
  thumbs: { flexDirection: 'row', minHeight: 40 },
  thumb: { width: 30, height: 40 },
});
