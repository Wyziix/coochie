import { StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useRestRemaining, useRestTimerControls } from '@/hooks/useRestTimer';
import { useTheme } from '@/hooks/useTheme';
import { formatDuration } from '@/lib/workout/format';
import { useWorkoutStore } from '@/stores/workoutStore';

export function RestTimerBar() {
  const theme = useTheme();
  const rest = useRestRemaining();
  const { adjust, skip } = useRestTimerControls();
  const exerciseName = useWorkoutStore(
    (s) => s.workout?.exercises.find((e) => e.key === s.restTimer?.exerciseKey)?.name ?? '',
  );
  if (!rest) return null;

  const progress = rest.total > 0 ? rest.remaining / rest.total : 0;

  return (
    <View
      accessibilityRole="timer"
      accessibilityLabel={`Rest ${formatDuration(rest.remaining)} left`}
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <View style={[styles.track, { backgroundColor: theme.colors.surfaceAlt }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.colors.primary },
          ]}
        />
      </View>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Button title="−15s" variant="secondary" onPress={() => adjust(-15, exerciseName)} />
        <View style={styles.center}>
          <Text variant="caption" color="textMuted">
            Rest
          </Text>
          <Text variant="title" style={styles.tabular}>
            {formatDuration(rest.remaining)}
          </Text>
        </View>
        <Button title="+15s" variant="secondary" onPress={() => adjust(15, exerciseName)} />
        <Button title="Skip" variant="ghost" onPress={skip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderWidth: StyleSheet.hairlineWidth },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
});
