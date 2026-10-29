import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/hooks/useTheme';
import { applyUpdate, useUpdateAvailable } from '@/lib/platform/serviceWorker';

/** Web: a new deploy is downloaded and waiting. Tapping reloads into it. */
export function UpdateBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const available = useUpdateAvailable();
  if (!available) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Update available, tap to reload"
      onPress={applyUpdate}
      style={[
        styles.banner,
        {
          top: insets.top + theme.spacing.sm,
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radius.lg,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        },
      ]}
    >
      <Ionicons name="refresh" size={16} color={theme.colors.onPrimary} />
      <Text variant="label" color="onPrimary">
        Update available, tap to reload
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 100,
    elevation: 4,
  },
});
