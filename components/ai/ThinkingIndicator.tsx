import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { THINKING_LABEL } from '@/lib/ai/labels';

/** "Gleb is thinking…" with a spinner, while Claude works. */
export function ThinkingIndicator({ hint }: { hint?: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={THINKING_LABEL}
      aria-busy
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
    >
      <ActivityIndicator color={theme.colors.primary} />
      <View style={{ flex: 1 }}>
        <Text color="textMuted">{THINKING_LABEL}</Text>
        {hint ? (
          <Text variant="caption" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** "Gleb is thinking" with dots that count up: the coach is typing. */
export function TypingDots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x % 3) + 1), 400);
    return () => clearInterval(t);
  }, []);
  return (
    <Text color="textMuted" accessibilityLabel={THINKING_LABEL}>
      {THINKING_LABEL.replace('…', '')}
      <Text color="primary">{'.'.repeat(n)}</Text>
    </Text>
  );
}
