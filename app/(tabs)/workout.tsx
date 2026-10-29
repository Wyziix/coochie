import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, EmptyState, Header, Screen, Text } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { useRecentWorkouts } from '@/hooks/useWorkouts';
import { formatWeight } from '@/lib/units';
import { formatDuration, formatDurationShort } from '@/lib/workout/format';
import { startEmptyWorkout } from '@/lib/workout/start';
import { useWorkoutStore } from '@/stores/workoutStore';

export default function WorkoutScreen() {
  const theme = useTheme();
  const { data: profile } = useProfile();
  const workout = useWorkoutStore((s) => s.workout);
  const now = useNow(1000, workout !== null);
  const recent = useRecentWorkouts();
  const units = profile?.units ?? 'kg';

  return (
    <Screen scroll header={<Header title="Workout" />}>
      {workout ? (
        <Card onPress={() => router.push('/workouts/active')} accessibilityLabel="Resume workout">
          <Text variant="caption" color="primary">
            In progress · {formatDuration((now - Date.parse(workout.startedAt)) / 1000)}
          </Text>
          <Text variant="heading">{workout.name}</Text>
          <Text color="textMuted">
            {workout.exercises.length} exercise{workout.exercises.length === 1 ? '' : 's'}
          </Text>
          <Button title="Resume workout" onPress={() => router.push('/workouts/active')} />
        </Card>
      ) : (
        <Button title="Start empty workout" onPress={() => startEmptyWorkout(units)} fullWidth />
      )}

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="heading">Recent</Text>
        {recent.data?.length ? (
          recent.data.map((w) => (
            <Card
              key={w.id}
              onPress={() => router.push({ pathname: '/workouts/[id]', params: { id: w.id } })}
              accessibilityLabel={`${w.name}, ${new Date(w.started_at).toLocaleDateString()}`}
            >
              <Text variant="label">{w.name}</Text>
              <Text variant="caption" color="textMuted">
                {new Date(w.started_at).toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}{' '}
                · {formatDurationShort(w.duration_seconds)} · {w.set_count} sets ·{' '}
                {formatWeight(w.total_volume_kg, units)}
              </Text>
            </Card>
          ))
        ) : recent.isPending ? null : (
          <EmptyState
            icon="barbell-outline"
            title="No workouts yet"
            message="Start one above. It's saved when you finish."
          />
        )}
      </View>
    </Screen>
  );
}
