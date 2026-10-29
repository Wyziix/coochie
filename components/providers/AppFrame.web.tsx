import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { UpdateBanner } from '@/components/offline/UpdateBanner';
import { useTheme } from '@/hooks/useTheme';
import { registerServiceWorker } from '@/lib/platform/serviceWorker';

export const APP_MAX_WIDTH = 600;

registerServiceWorker();

/**
 * Web: centers the app in a phone-width column so it looks like the app on
 * big screens instead of stretching edge to edge. On phones it's full width.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const framed = width > APP_MAX_WIDTH;

  return (
    <View
      style={[
        styles.outer,
        { backgroundColor: framed ? theme.colors.frame : theme.colors.background },
      ]}
    >
      <View
        style={[
          styles.column,
          { backgroundColor: theme.colors.background },
          framed && { borderColor: theme.colors.border, borderLeftWidth: 1, borderRightWidth: 1 },
        ]}
      >
        {children}
        <UpdateBanner />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: APP_MAX_WIDTH, overflow: 'hidden' },
});
