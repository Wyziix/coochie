import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import type { ThemeColors } from '@/lib/theme';

export type IconButtonProps = {
  icon: ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  onPress: () => void;
  color?: keyof ThemeColors;
  size?: number;
  disabled?: boolean;
};

/** Square icon-only button with a 44pt touch target. */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  color = 'text',
  size = 22,
  disabled,
}: IconButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        { borderRadius: theme.radius.md, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={icon} size={size} color={theme.colors[color]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
