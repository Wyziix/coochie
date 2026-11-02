import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { useWorkoutPoints } from '@/hooks/usePoints';
import { useTheme } from '@/hooks/useTheme';
import { describeItem, signed } from '@/lib/points/labels';

/** Points for a workout, or "Under review" (never the reasons). */
export function WorkoutPointsCard({
  workoutId,
  waitingToSync,
}: {
  workoutId: string;
  waitingToSync: boolean;
}) {
  const theme = useTheme();
  const { data } = useWorkoutPoints(workoutId, !waitingToSync);

  if (waitingToSync) {
    return (
      <Card>
        <Text variant="label">Points</Text>
        <Text variant="caption" color="textMuted">
          Points are added once this workout has synced.
        </Text>
      </Card>
    );
  }
  if (!data) return null;
  if (data.review === 'pending') {
    return (
      <Card>
        <Text variant="label">Under review</Text>
        <Text variant="caption" color="textMuted">
          This workout gets a quick check before its points are added. Nothing to do on your side.
        </Text>
      </Card>
    );
  }
  if (data.review === 'rejected') {
    return (
      <Card>
        <Text variant="label">No points for this workout</Text>
        <Text variant="caption" color="textMuted">
          It stays in your history and progress as usual.
        </Text>
      </Card>
    );
  }
  return (
    <Card>
      <Text variant="label" color={data.points > 0 ? 'success' : 'text'}>
        {data.points > 0 ? `${signed(data.points)} points` : 'No points for this workout'}
      </Text>
      {data.items.map((item, i) => (
        <View key={`${item.reason}-${i}`} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {describeItem(item)}
          </Text>
          <Text variant="caption">{signed(item.points)}</Text>
        </View>
      ))}
      {data.points === 0 && data.items.length === 0 ? (
        <Text variant="caption" color="textMuted">
          Workouts with at least 3 working sets earn points.
        </Text>
      ) : null}
    </Card>
  );
}
