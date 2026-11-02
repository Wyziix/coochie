import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { useMyStreak } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';

/** Weekly streak (from the points: weeks in a row with the goal hit). */
export function StreakCard() {
  const theme = useTheme();
  const { data } = useMyStreak();
  if (!data) return null;
  const left = Math.max(0, (data.goal ?? 0) - (data.this_week_sessions ?? 0));
  return (
    <Card accessibilityLabel={`Streak: ${data.current} weeks, longest ${data.longest}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Ionicons
          name={data.current > 0 ? 'flame' : 'flame-outline'}
          size={28}
          color={data.current > 0 ? theme.colors.warning : theme.colors.textMuted}
        />
        <View style={{ flex: 1 }}>
          <Text variant="label">
            {data.current} week{data.current === 1 ? '' : 's'} streak
          </Text>
          <Text variant="caption" color="textMuted">
            Longest {data.longest} ·{' '}
            {data.this_week_done
              ? 'This week’s goal done'
              : left > 0
                ? `${left} more session${left === 1 ? '' : 's'} this week`
                : 'Keep going'}
          </Text>
        </View>
      </View>
    </Card>
  );
}
