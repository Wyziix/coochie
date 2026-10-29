import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/hooks/useTheme';
import { useIsOnline } from '@/lib/offline/network';
import { useOutboxCounts } from '@/lib/offline/outbox';

/** "Offline · 2 waiting to sync" in the screen header. Hidden when all is synced. */
export function SyncStatus() {
  const theme = useTheme();
  const online = useIsOnline();
  const { waiting, failed } = useOutboxCounts();
  if (online && waiting === 0 && failed === 0) return null;

  const parts = [
    online ? null : 'Offline',
    waiting ? `${waiting} change${waiting === 1 ? '' : 's'} waiting to sync` : null,
    failed ? `${failed} couldn’t sync` : null,
  ].filter(Boolean);
  const color = failed ? 'danger' : online ? 'primary' : 'textMuted';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${parts.join(', ')}. Open sync details`}
      onPress={() => router.push('/sync')}
      style={[
        styles.pill,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
        },
      ]}
    >
      <Ionicons
        name={failed ? 'alert-circle-outline' : online ? 'sync-outline' : 'cloud-offline-outline'}
        size={14}
        color={theme.colors[color]}
      />
      <Text variant="caption" color={color} numberOfLines={1}>
        {parts.join(' · ')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
});
