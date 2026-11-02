import { Switch, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

/** A labelled on/off switch row. */
export function Toggle({
  label,
  note,
  value,
  disabled,
  onChange,
}: {
  label: string;
  note?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 44 }}
    >
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {note ? (
          <Text variant="caption" color="textMuted">
            {note}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        aria-checked={value}
        aria-disabled={disabled}
        trackColor={{ true: theme.colors.primary, false: theme.colors.surfaceAlt }}
      />
    </View>
  );
}
