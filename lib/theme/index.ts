import { colors, type ColorScheme, type ThemeColors } from './colors';
import { radius, spacing, typography } from './tokens';

export type Theme = {
  scheme: ColorScheme;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
};

export function buildTheme(scheme: ColorScheme): Theme {
  return { scheme, colors: colors[scheme], spacing, radius, typography };
}

export { colors, radius, spacing, typography };
export type { ColorScheme, ThemeColors };
export type { TypographyVariant } from './tokens';
