import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

import { Button } from './Button';
import { Text } from './Text';

export type EmptyStateProps = {
  title: string;
  message?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, message, icon, actionLabel, onAction }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { gap: theme.spacing.md, padding: theme.spacing.xl }]}>
      {icon ? <Ionicons name={icon} size={48} color={theme.colors.textMuted} /> : null}
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {message ? (
        <Text color="textMuted" style={styles.center}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
});
