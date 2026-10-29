import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

export const CHIP_HEIGHT = 36;

type Props = { children: ReactNode; accessibilityLabel?: string };

/**
 * One horizontally scrolling row of chips. Fixed height and no shrinking:
 * in a column next to a long list, a ScrollView is otherwise squashed by
 * flexbox (react-native-web gives ScrollView flexShrink: 1).
 */
export function ChipRow({ children, accessibilityLabel }: Props) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={accessibilityLabel}
      style={styles.row}
      contentContainerStyle={[
        styles.content,
        { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
      ]}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexGrow: 0, flexShrink: 0, height: CHIP_HEIGHT },
  content: { alignItems: 'center', height: CHIP_HEIGHT },
});
