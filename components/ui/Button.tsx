import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import type { ThemeColors } from '@/lib/theme';

import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
};

const variantColors: Record<
  ButtonVariant,
  { bg: keyof ThemeColors | null; fg: keyof ThemeColors; border?: keyof ThemeColors }
> = {
  primary: { bg: 'primary', fg: 'onPrimary' },
  secondary: { bg: 'surfaceAlt', fg: 'text', border: 'border' },
  ghost: { bg: null, fg: 'primary' },
  danger: { bg: 'danger', fg: 'onDanger' },
};

export function Button({
  title,
  variant = 'primary',
  loading = false,
  fullWidth = false,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const theme = useTheme();
  const v = variantColors[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={!!isDisabled}
      aria-busy={loading}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        {
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.lg,
          backgroundColor: v.bg ? theme.colors[v.bg] : 'transparent',
          borderColor: v.border ? theme.colors[v.border] : 'transparent',
          opacity: isDisabled ? 0.5 : state.pressed ? 0.8 : 1,
        },
        fullWidth && styles.fullWidth,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors[v.fg]} />
      ) : (
        <Text variant="label" color={v.fg}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
