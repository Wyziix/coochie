import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useFlaggedWorkouts, useReviewWorkout } from '@/hooks/usePoints';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import type { FlaggedWorkout } from '@/lib/api/points';
import { describeError } from '@/lib/errors';
import { describeFlag } from '@/lib/points/labels';
import { formatWeight } from '@/lib/units';

type Status = 'pending' | 'approved' | 'rejected';
const statuses: { value: Status; label: string }[] = [
  { value: 'pending', label: 'To review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** Admin → Flagged workouts: reasons and sets, approve (points) or reject (no points). */
export default function FlaggedWorkoutsScreen() {
  const theme = useTheme();
  const [status, setStatus] = useState<Status>('pending');
  const list = useFlaggedWorkouts(status);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <Text color="textMuted">
        Suspicious workouts get no points until you approve them. The user only sees “Under review”.
      </Text>
      <SegmentedControl
        options={statuses}
        value={status}
        onChange={setStatus}
        accessibilityLabel="Status"
      />
      {list.isPending ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title={status === 'pending' ? 'Nothing to review' : 'None yet'}
          message={status === 'pending' ? 'New flagged workouts show up here.' : undefined}
        />
      ) : (
        list.data.map((w) => <Flagged key={w.workout_id} workout={w} />)
      )}
    </ScrollView>
  );
}

function Flagged({ workout: w }: { workout: FlaggedWorkout }) {
  const theme = useTheme();
  const unit = useProfile().data?.units ?? 'kg';
  const review = useReviewWorkout();
  const kg = (n: number) => formatWeight(n, unit);
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text variant="heading">{w.username ?? w.display_name ?? 'User'}</Text>
          <Text variant="caption" color="textMuted">
            {w.name} · {new Date(w.started_at).toLocaleString()} ·{' '}
            {Math.round(w.duration_seconds / 60)} min
            {w.bodyweight_kg ? ` · bodyweight ${kg(w.bodyweight_kg)}` : ''}
          </Text>
        </View>
      </View>
      <View style={{ gap: theme.spacing.xs }}>
        {w.reasons.map((r, i) => (
          <Text key={i} color="danger">
            • {describeFlag(r, kg)}
          </Text>
        ))}
      </View>
      <View style={{ gap: 2 }}>
        {w.sets.map((s, i) => (
          <Text key={i} variant="caption" color={s.set_type === 'warmup' ? 'textMuted' : 'text'}>
            {s.exercise}: {s.weight_kg != null ? `${kg(s.weight_kg)} × ` : ''}
            {s.reps ?? (s.duration_seconds ? `${s.duration_seconds}s` : '–')}
            {s.set_type === 'warmup' ? ' (warm-up)' : ''}
          </Text>
        ))}
      </View>
      {w.status === 'pending' ? (
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <View style={styles.flex}>
            <Button
              title="Approve"
              onPress={() => review.mutate({ workoutId: w.workout_id, approve: true })}
              loading={review.isPending && review.variables?.approve}
              disabled={review.isPending}
              accessibilityLabel={`Approve ${w.name} by ${w.username}`}
              fullWidth
            />
          </View>
          <View style={styles.flex}>
            <Button
              title="Reject"
              variant="danger"
              onPress={() => review.mutate({ workoutId: w.workout_id, approve: false })}
              loading={review.isPending && review.variables?.approve === false}
              disabled={review.isPending}
              accessibilityLabel={`Reject ${w.name} by ${w.username}`}
              fullWidth
            />
          </View>
        </View>
      ) : (
        <Text variant="caption" color="textMuted">
          {w.status === 'approved' ? 'Approved: points granted' : 'Rejected: no points'}
          {w.reviewed_at ? ` · ${new Date(w.reviewed_at).toLocaleString()}` : ''}
        </Text>
      )}
      {review.error ? <Text color="danger">{describeError(review.error).message}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
