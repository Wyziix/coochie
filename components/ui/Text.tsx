import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import type { ThemeColors, TypographyVariant } from '@/lib/theme';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: keyof ThemeColors;
};

export function Text({ variant = 'body', color = 'text', style, ...props }: TextProps) {
  const theme = useTheme();
  return (
    <RNText style={[theme.typography[variant], { color: theme.colors[color] }, style]} {...props} />
  );
}
