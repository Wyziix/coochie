import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

import { Text } from './Text';

export type OptionListItem<T extends string> = { value: T; label: string; description?: string };

export type OptionListProps<T extends string> = {
  options: OptionListItem<T>[];
  value: T | null;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

/** Vertical single-choice list with a description per option. */
export function OptionList<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: OptionListProps<T>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ gap: theme.spacing.sm }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            aria-checked={selected}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.row,
              {
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.text}>
              <Text variant="label">{option.label}</Text>
              {option.description ? (
                <Text variant="caption" color="textMuted">
                  {option.description}
                </Text>
              ) : null}
            </View>
            <Ionicons
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={selected ? theme.colors.primary : theme.colors.border}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
