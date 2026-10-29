import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { SyncStatus } from '@/components/offline/SyncStatus';
import { useTheme } from '@/hooks/useTheme';

import { Text } from './Text';

export type HeaderProps = {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
};

export function Header({ title, subtitle, left, right }: HeaderProps) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.spacing.md, paddingVertical: theme.spacing.md }]}>
      {left}
      <View style={styles.titles}>
        <Text variant="title" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        <SyncStatus />
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titles: {
    flex: 1,
  },
});
