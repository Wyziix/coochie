import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgressBar } from '@/components/points/ProgressBar';
import { Button, Card, LoadingState, Text } from '@/components/ui';
import { useWorkoutPoints } from '@/hooks/usePoints';
import { useProfile } from '@/hooks/useProfile';
import { useWorkoutRecords } from '@/hooks/useProgress';
import { useTheme } from '@/hooks/useTheme';
import { restDoneAlert } from '@/lib/platform/feedback';
import { levelProgress, signed } from '@/lib/points/labels';
import { formatRecordValue, groupByExercise, recordLabels } from '@/lib/progress/records';

/**
 * Shown after finishing a workout that set new records or reached a new
 * level. Records and points come from the server, which computed them while
 * saving.
 */
export default function CelebrateScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: records, isPending } = useWorkoutRecords(id);
  const points = useWorkoutPoints(id).data;
  const levelUp = !!points && points.level_after.level > points.level_before.level;
  const unit = useProfile().data?.units ?? 'kg';
  const [scale] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    if (!records?.length && !levelUp) return;
    restDoneAlert();
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [records?.length, levelUp, scale]);

  const next = () => router.replace({ pathname: '/workouts/[id]', params: { id, finished: '1' } });

  if (isPending) return <LoadingState />;
  const groups = groupByExercise(records ?? []);
  const count = records?.length ?? 0;

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      edges={['top', 'bottom']}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg, flexGrow: 1 }}
      >
        <View style={[styles.hero, { gap: theme.spacing.sm }]}>
          <Animated.View style={{ transform: [{ scale }] }}>
            <Ionicons
              name={levelUp ? 'star' : 'trophy'}
              size={88}
              color={levelUp ? theme.colors.primary : theme.colors.warning}
            />
          </Animated.View>
          {levelUp ? (
            <>
              <Text variant="title" accessibilityRole="header" style={styles.center}>
                Level up!
              </Text>
              <Text variant="heading" style={styles.center}>
                Level {points.level_after.level} · {points.level_after.name}
              </Text>
            </>
          ) : null}
          {count > 0 ? (
            <>
              <Text
                variant={levelUp ? 'heading' : 'title'}
                accessibilityRole={levelUp ? undefined : 'header'}
                style={styles.center}
              >
                {count === 1 ? 'New personal record!' : `${count} new personal records!`}
              </Text>
              <Text color="textMuted" style={styles.center}>
                You beat your best on {groups.length} exercise{groups.length === 1 ? '' : 's'}.
              </Text>
            </>
          ) : null}
          {points && points.review === null && points.points > 0 ? (
            <Text variant="label" color="success" style={styles.center}>
              {signed(points.points)} points
            </Text>
          ) : null}
        </View>

        {levelUp ? (
          <Card>
            <ProgressBar
              value={levelProgress(points.level_after)}
              label={`Progress to level ${points.level_after.level + 1}`}
            />
            <Text variant="caption" color="textMuted">
              {points.level_after.next_points != null
                ? `${(points.level_after.next_points - points.level_after.points).toLocaleString()} points to level ${points.level_after.level + 1}`
                : 'You reached the top level.'}
            </Text>
          </Card>
        ) : null}

        {groups.map((g) => (
          <Card key={g.exerciseId}>
            <Text variant="heading">{g.name}</Text>
            {g.records.map((r) => (
              <View key={`${r.record_type}-${r.weight_kg}`} style={styles.line}>
                <Text color="textMuted" style={styles.flex}>
                  {recordLabels[r.record_type]}
                </Text>
                <View style={styles.right}>
                  <Text variant="label" color="success">
                    {formatRecordValue(r, unit)}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    was {formatRecordValue(r, unit, r.previous_value)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        ))}

        <View style={styles.flex} />
        <Button title="Continue" onPress={next} fullWidth />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { alignItems: 'center', paddingVertical: 16 },
  center: { textAlign: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  right: { alignItems: 'flex-end' },
  flex: { flex: 1 },
});
