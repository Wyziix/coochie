import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { buildTheme, type ColorScheme, type Theme } from '@/lib/theme';
import { useThemeStore, type ThemePreference } from '@/stores/themeStore';

export function resolveScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ColorScheme {
  if (preference === 'system') return system === 'dark' ? 'dark' : 'light';
  return preference;
}

export function useTheme(): Theme {
  const system = useColorScheme();
  const preference = useThemeStore((s) => s.preference);
  const scheme = resolveScheme(preference, system);
  return useMemo(() => buildTheme(scheme), [scheme]);
}
