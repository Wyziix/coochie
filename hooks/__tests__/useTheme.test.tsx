import { act, renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';

import { resolveScheme, useTheme } from '@/hooks/useTheme';
import { colors } from '@/lib/theme';
import { useThemeStore } from '@/stores/themeStore';

describe('resolveScheme', () => {
  it('follows the system when preference is system', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
  });

  it('uses the manual preference over the system', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});

describe('useTheme', () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: 'system' });
  });

  it('returns dark colors when the system is dark', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('dark');
    expect(result.current.colors).toEqual(colors.dark);
  });

  it('switches when the manual preference changes', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme());
    await act(() => useThemeStore.getState().setPreference('light'));
    expect(result.current.scheme).toBe('light');
  });
});
