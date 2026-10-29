import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

type Props = {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  error?: string | null;
  onNext: () => void;
  onBack?: () => void;
};

export function StepLayout({
  step,
  total,
  title,
  subtitle,
  children,
  nextLabel = 'Next',
  nextDisabled,
  loading,
  error,
  onNext,
  onBack,
}: Props) {
  const theme = useTheme();
  const progress = `${Math.round((step / total) * 100)}%` as const;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={`Step ${step} of ${total}`}
            accessibilityValue={{ min: 0, max: total, now: step }}
            style={[styles.track, { backgroundColor: theme.colors.surfaceAlt }]}
          >
            <View
              style={[styles.fill, { width: progress, backgroundColor: theme.colors.primary }]}
            />
          </View>
          <Text variant="caption" color="textMuted">
            Step {step} of {total}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text color="textMuted">{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>

        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
          {error ? (
            <Text color="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <View style={[styles.buttons, { gap: theme.spacing.md }]}>
            {onBack ? (
              <Button title="Back" variant="secondary" onPress={onBack} style={styles.flex} />
            ) : null}
            <Button
              title={nextLabel}
              onPress={onNext}
              disabled={nextDisabled}
              loading={loading}
              style={styles.flex}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%' },
  buttons: { flexDirection: 'row' },
  flex: { flex: 1 },
});
