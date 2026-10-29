import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { useIsOnline } from '@/lib/offline/network';

import { Text } from './Text';

export type LoadingStateProps = {
  message?: string;
};

export function LoadingState({ message }: LoadingStateProps) {
  const theme = useTheme();
  const online = useIsOnline();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? 'Loading'}
      style={[styles.container, { gap: theme.spacing.md }]}
    >
      <ActivityIndicator size="large" color={theme.colors.primary} />
      {message ? <Text color="textMuted">{message}</Text> : null}
      {online ? null : (
        <Text color="textMuted" style={styles.offline}>
          No connection. This loads when you’re back online.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  offline: { textAlign: 'center', paddingHorizontal: 24 },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
