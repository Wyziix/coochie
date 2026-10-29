import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { IconButton, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { Exercise } from '@/lib/api/exercises';
import { equipmentLabels, muscleLabels } from '@/lib/exercises/labels';

type Props = {
  exercise: Exercise;
  selected?: boolean;
  onPress: () => void;
  onInfo?: () => void;
};

export function ExerciseRow({ exercise, selected, onPress, onInfo }: Props) {
  const theme = useTheme();
  const tags = [
    muscleLabels[exercise.primary_muscle],
    equipmentLabels[exercise.equipment],
    exercise.owner_id ? 'Custom' : null,
    exercise.is_hidden ? 'Hidden' : null,
  ].filter(Boolean);

  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
      <Pressable
        accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
        aria-checked={selected}
        accessibilityLabel={exercise.name}
        onPress={onPress}
        style={({ pressed }) => [
          styles.main,
          { gap: theme.spacing.md, paddingVertical: theme.spacing.md, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        {selected !== undefined ? (
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={selected ? theme.colors.primary : theme.colors.border}
          />
        ) : null}
        <View style={styles.flex}>
          <Text variant="label" color={exercise.is_hidden ? 'textMuted' : 'text'}>
            {exercise.name}
          </Text>
          <Text variant="caption" color="textMuted">
            {tags.join(' · ')}
          </Text>
        </View>
      </Pressable>
      {onInfo ? (
        <IconButton
          icon="information-circle-outline"
          accessibilityLabel={`About ${exercise.name}`}
          color="textMuted"
          onPress={onInfo}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
