import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';

export type ScreenProps = {
  children: ReactNode;
  header?: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
};

export function Screen({
  children,
  header,
  scroll = false,
  padded = true,
  edges = ['top'],
}: ScreenProps) {
  const theme = useTheme();
  const padding = padded ? theme.spacing.lg : 0;

  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {header ? <View style={{ paddingHorizontal: padding }}>{header}</View> : null}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding, paddingTop: 0, gap: theme.spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, { padding, paddingTop: 0, gap: theme.spacing.lg }]}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
