import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { ProgressBar } from '@/components/points/ProgressBar';
import { Button, Card, Text } from '@/components/ui';
import { useAddWater, useRemoveWater } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import type { WaterLog } from '@/lib/api/nutrition';

/** Water with +250 / +500 ml buttons (work offline) and the daily goal. */
export function WaterCard({
  day,
  water,
  total,
  goal,
}: {
  day: string;
  water: WaterLog[];
  total: number;
  goal: number;
}) {
  const theme = useTheme();
  const add = useAddWater();
  const remove = useRemoveWater();
  const last = water.at(-1);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="water-outline" size={22} color={theme.colors.primary} />
        <Text variant="label" style={{ flex: 1 }}>
          Water
        </Text>
        <Text variant="label">
          {(total / 1000).toFixed(2)} / {(goal / 1000).toFixed(1)} L
        </Text>
      </View>
      <ProgressBar value={total / goal} label={`Water: ${total} of ${goal} ml`} />
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        <Button title="+250 ml" variant="secondary" onPress={() => add.mutate({ day, ml: 250 })} />
        <Button title="+500 ml" variant="secondary" onPress={() => add.mutate({ day, ml: 500 })} />
        {last ? (
          <Button
            title={`Undo ${last.ml} ml`}
            variant="ghost"
            onPress={() => remove.mutate(last)}
          />
        ) : null}
      </View>
    </Card>
  );
}
