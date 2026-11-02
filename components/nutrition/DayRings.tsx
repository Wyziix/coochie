import { View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import type { Targets } from '@/lib/api/nutrition';
import type { Totals } from '@/lib/nutrition/calc';

import { Ring } from './Ring';

export function DayRings({
  totals,
  targets,
}: {
  totals: Totals;
  targets: Targets | null | undefined;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        alignItems: 'center',
        gap: theme.spacing.md,
      }}
    >
      <Ring
        value={totals.kcal}
        target={targets?.kcal ?? null}
        label="Calories"
        unit="kcal"
        size={116}
        large
      />
      <Ring value={totals.protein} target={targets?.protein_g ?? null} label="Protein" unit="g" />
      <Ring value={totals.carbs} target={targets?.carbs_g ?? null} label="Carbs" unit="g" />
      <Ring value={totals.fat} target={targets?.fat_g ?? null} label="Fat" unit="g" />
    </View>
  );
}
