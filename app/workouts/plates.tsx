import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { MeasurementInput } from '@/components/profile/MeasurementInput';
import { Card, Chip, Text } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { parseNumber } from '@/lib/workout/format';
import { BARS, calculatePlates, PLATES } from '@/lib/workout/plates';
import { useWorkoutStore } from '@/stores/workoutStore';

export default function PlateCalculatorScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ weight?: string }>();
  const workoutUnit = useWorkoutStore((s) => s.workout?.units);
  const profileUnit = useProfile().data?.units;
  const unit = workoutUnit ?? profileUnit ?? 'kg';
  const [target, setTarget] = useState(params.weight ?? '');
  const [bar, setBar] = useState(BARS[unit][0]!);

  const result = calculatePlates(parseNumber(target) ?? 0, bar, PLATES[unit]);
  const maxPlate = PLATES[unit][0]!;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <MeasurementInput
        label="Target weight"
        unit={unit}
        value={target}
        onChange={setTarget}
        autoFocus
      />

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" color="textMuted">
          Bar
        </Text>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          {BARS[unit].map((b) => (
            <Chip
              key={b}
              label={`${b} ${unit}`}
              selected={bar === b}
              accessibilityRole="radio"
              onPress={() => setBar(b)}
            />
          ))}
        </View>
      </View>

      <Card>
        <Text variant="heading">Each side</Text>
        {!target ? (
          <Text color="textMuted">Enter a weight to see the plates.</Text>
        ) : !result.ok ? (
          <Text color="danger">{result.error}</Text>
        ) : result.perSide.length === 0 ? (
          <Text color="textMuted">Just the bar.</Text>
        ) : (
          <>
            <View
              style={[styles.stack, { gap: 3 }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {result.perSide.flatMap(({ plate, count }) =>
                Array.from({ length: count }, (_, i) => (
                  <View
                    key={`${plate}-${i}`}
                    style={{
                      width: 14,
                      height: 40 + 80 * (plate / maxPlate),
                      borderRadius: 3,
                      backgroundColor: theme.colors.primary,
                      opacity: 0.45 + 0.55 * (plate / maxPlate),
                    }}
                  />
                )),
              )}
            </View>
            {result.perSide.map(({ plate, count }) => (
              <Text key={plate} variant="label">
                {count} × {plate} {unit}
              </Text>
            ))}
          </>
        )}
        {result.ok && result.remainder > 0 ? (
          <Text variant="caption" color="warning">
            Closest you can load: {result.loaded} {unit} ({result.remainder} {unit} short)
          </Text>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  stack: { flexDirection: 'row', alignItems: 'center', minHeight: 124 },
});
