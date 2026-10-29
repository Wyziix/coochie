import AsyncStorage from '@react-native-async-storage/async-storage';

import { useThemeStore } from '@/stores/themeStore';

describe('themeStore', () => {
  it('defaults to system', () => {
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('persists the preference', async () => {
    useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
    const saved = await AsyncStorage.getItem('theme-preference');
    expect(JSON.parse(saved ?? '{}').state.preference).toBe('dark');
  });
});
