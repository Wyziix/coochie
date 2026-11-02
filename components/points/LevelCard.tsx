import { router } from 'expo-router';
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { useMyPoints } from '@/hooks/usePoints';
import { useTheme } from '@/hooks/useTheme';
import { levelProgress } from '@/lib/points/labels';

import { ProgressBar } from './ProgressBar';

/** Level, name and the bar to the next level. Opens the points history. */
export function LevelCard() {
  const theme = useTheme();
  const { data } = useMyPoints();
  if (!data) return null;
  const { level } = data;
  const toNext = level.next_points != null ? level.next_points - level.points : null;
  return (
    <Card
      onPress={() => router.push('/points')}
      accessibilityLabel={`Level ${level.level}, ${level.name}, ${data.total} points`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
        <Text variant="heading">Level {level.level}</Text>
        <Text color="textMuted" style={{ flex: 1 }}>
          {level.name}
        </Text>
        <Text variant="label">{data.total.toLocaleString()} pts</Text>
      </View>
      <ProgressBar value={levelProgress(level)} label={`Progress to level ${level.level + 1}`} />
      <Text variant="caption" color="textMuted">
        {toNext != null
          ? `${toNext.toLocaleString()} points to level ${level.level + 1} · ${data.week.toLocaleString()} this week`
          : `Top level reached · ${data.week.toLocaleString()} this week`}
        {data.under_review ? ` · ${data.under_review} under review` : ''}
      </Text>
    </Card>
  );
}
