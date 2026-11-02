import { View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

/** Thin horizontal bar, 0..1. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const theme = useTheme();
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      style={{
        height: 8,
        borderRadius: theme.radius.full,
        backgroundColor: theme.colors.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: theme.colors.primary }} />
    </View>
  );
}
