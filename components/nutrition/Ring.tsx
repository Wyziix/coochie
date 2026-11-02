import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

/** A progress ring: value of target, with a label in the middle. */
export function Ring({
  value,
  target,
  label,
  unit,
  size = 88,
  large,
}: {
  value: number;
  target: number | null;
  label: string;
  unit: string;
  size?: number;
  large?: boolean;
}) {
  const theme = useTheme();
  const stroke = large ? 10 : 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = target ? Math.min(value / target, 1) : 0;
  const over = target != null && value > target * 1.05;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${Math.round(value)}${target ? ` of ${target}` : ''} ${unit}`}
      aria-valuenow={Math.round(pct * 100)}
      style={{ alignItems: 'center', gap: 4 }}
    >
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg
          width={size}
          height={size}
          style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
        >
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={theme.colors.surfaceAlt}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={over ? theme.colors.warning : theme.colors.primary}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
          />
        </Svg>
        <Text variant={large ? 'heading' : 'label'}>{Math.round(value)}</Text>
        <Text variant="caption" color="textMuted">
          {target ? `/ ${target}` : unit}
        </Text>
      </View>
      <Text variant="caption" color="textMuted">
        {label}
        {target ? ` (${unit})` : ''}
      </Text>
    </View>
  );
}
