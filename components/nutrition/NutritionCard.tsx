import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { ProgressBar } from '@/components/points/ProgressBar';
import { Card, Text } from '@/components/ui';
import { useNutritionDay, useTargets } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import { localDay } from '@/lib/nutrition/calc';

/** Today's calories and protein vs targets; opens the food log. */
export function NutritionCard() {
  const theme = useTheme();
  const day = useNutritionDay(localDay());
  const targets = useTargets().data;
  const t = day.data?.totals;
  return (
    <Card
      onPress={() => router.push('/nutrition')}
      accessibilityLabel={`Nutrition today: ${t?.kcal ?? 0} kcal`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="nutrition-outline" size={22} color={theme.colors.primary} />
        <Text variant="label" style={{ flex: 1 }}>
          Nutrition today
        </Text>
        <Text variant="label">
          {t?.kcal ?? 0}
          {targets ? ` / ${targets.kcal}` : ''} kcal
        </Text>
      </View>
      {targets ? (
        <ProgressBar value={(t?.kcal ?? 0) / targets.kcal} label="Calories today" />
      ) : null}
      <Text variant="caption" color="textMuted">
        {targets
          ? `Protein ${Math.round(t?.protein ?? 0)} / ${targets.protein_g} g · water ${((day.data?.water_ml ?? 0) / 1000).toFixed(1)} L`
          : 'Tap to log food and set targets'}
      </Text>
    </Card>
  );
}
