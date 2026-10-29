import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { LastSet } from '@/lib/api/exercises';
import { setTypeLabels, type ExerciseType } from '@/lib/exercises/labels';
import type { WeightUnit } from '@/lib/units';
import { durationUnitFor, fieldsFor, formatLastSet } from '@/lib/workout/sets';
import type { ActiveSet } from '@/lib/workout/types';

import { CellInput } from './CellInput';

type Props = {
  set: ActiveSet;
  number: number;
  type: ExerciseType;
  unit: WeightUnit;
  last?: LastSet;
  placeholder: Partial<ActiveSet>;
  invalid?: boolean;
  onChange: (patch: Partial<ActiveSet>) => void;
  onToggleDone: () => void;
  onOpenOptions: () => void;
  onUsePrevious: () => void;
};

export function SetRow({
  set,
  number,
  type,
  unit,
  last,
  placeholder,
  invalid,
  onChange,
  onToggleDone,
  onOpenOptions,
  onUsePrevious,
}: Props) {
  const theme = useTheme();
  const f = fieldsFor(type);
  const label = setTypeLabels[set.type].short || String(number);
  const labelColor = set.type === 'warmup' ? 'warning' : set.type === 'normal' ? 'text' : 'danger';
  const name = `Set ${number}`;

  return (
    <View
      style={[
        styles.row,
        {
          gap: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
          backgroundColor: set.done ? theme.colors.surfaceAlt : 'transparent',
          borderRadius: theme.radius.sm,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} options (${setTypeLabels[set.type].label})`}
        onPress={onOpenOptions}
        style={styles.setCol}
      >
        <Text variant="label" color={labelColor}>
          {label}
        </Text>
        {set.rpe ? (
          <Text variant="caption" color="textMuted">
            @{set.rpe}
          </Text>
        ) : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} previous: ${formatLastSet(last, type, unit)}. Tap to copy.`}
        onPress={onUsePrevious}
        disabled={!last}
        style={styles.prevCol}
      >
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {formatLastSet(last, type, unit)}
        </Text>
      </Pressable>

      {f.weight ? (
        <CellInput
          accessibilityLabel={`${name} weight (${unit})`}
          value={set.weight}
          onChangeText={(weight) => onChange({ weight: weight.replace(/[^0-9.,]/g, '') })}
          placeholder={placeholder.weight || (type === 'bodyweight' ? '+0' : unit)}
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={6}
          done={set.done}
          invalid={invalid && type === 'weights' && !set.weight}
        />
      ) : null}
      {f.reps ? (
        <CellInput
          accessibilityLabel={`${name} reps`}
          value={set.reps}
          onChangeText={(reps) => onChange({ reps: reps.replace(/\D/g, '') })}
          placeholder={placeholder.reps || 'reps'}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={4}
          done={set.done}
          invalid={invalid && !set.reps}
        />
      ) : null}
      {f.duration ? (
        <CellInput
          accessibilityLabel={`${name} time (${durationUnitFor(type) === 'minutes' ? 'min or m:ss' : 'sec or m:ss'})`}
          value={set.duration}
          onChangeText={(duration) => onChange({ duration: duration.replace(/[^0-9:.,]/g, '') })}
          placeholder={
            placeholder.duration || (durationUnitFor(type) === 'minutes' ? 'min' : 'sec')
          }
          keyboardType="numbers-and-punctuation"
          maxLength={8}
          done={set.done}
          invalid={invalid && !set.duration}
        />
      ) : null}
      {f.distance ? (
        <CellInput
          accessibilityLabel={`${name} distance (${unit === 'lbs' ? 'mi' : 'km'})`}
          value={set.distance}
          onChangeText={(distance) => onChange({ distance: distance.replace(/[^0-9.,]/g, '') })}
          placeholder={placeholder.distance || (unit === 'lbs' ? 'mi' : 'km')}
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={6}
          done={set.done}
        />
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        aria-checked={set.done}
        accessibilityLabel={`${name} done`}
        onPress={onToggleDone}
        hitSlop={6}
        style={[
          styles.done,
          {
            borderRadius: theme.radius.sm,
            backgroundColor: set.done ? theme.colors.success : theme.colors.surfaceAlt,
          },
        ]}
      >
        <Ionicons
          name="checkmark"
          size={22}
          color={set.done ? theme.colors.onPrimary : theme.colors.textMuted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  setCol: { width: 32, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  prevCol: { flex: 1.4, minWidth: 0, justifyContent: 'center', minHeight: 40 },
  done: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
});
