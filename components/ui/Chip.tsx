import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

import { Text } from './Text';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityRole?: 'button' | 'checkbox' | 'radio';
};

export function Chip({
  label,
  selected = false,
  onPress,
  accessibilityRole = 'button',
}: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      aria-selected={accessibilityRole === 'button' ? selected : undefined}
      aria-checked={accessibilityRole === 'button' ? undefined : selected}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: theme.radius.full,
          paddingHorizontal: theme.spacing.md,
          backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceAlt,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text variant="label" color={selected ? 'onPrimary' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
