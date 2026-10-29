import { SegmentedControl, type SegmentedOption } from '@/components/ui';
import { useThemeStore, type ThemePreference } from '@/stores/themeStore';

const options: SegmentedOption<ThemePreference>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <SegmentedControl
      accessibilityLabel="Theme"
      options={options}
      value={preference}
      onChange={setPreference}
    />
  );
}
