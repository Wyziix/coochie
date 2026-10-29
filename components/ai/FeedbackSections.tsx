import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

/** A titled list ("What went well", "Next time", …); nothing if empty. */
export function FeedbackList({
  title,
  items,
  color = 'text',
}: {
  title: string;
  items: string[];
  color?: 'text' | 'danger' | 'success';
}) {
  const theme = useTheme();
  if (!items.length) return null;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" color={color === 'text' ? 'textMuted' : color}>
        {title}
      </Text>
      {items.map((item, i) => (
        <View key={i} style={[styles.item, { gap: theme.spacing.sm }]}>
          <Text color="textMuted">•</Text>
          <Text style={styles.flex}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/** Shown when pain or injury came up: not a diagnosis, see a professional. */
export function SeeProfessional() {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.item,
        {
          gap: theme.spacing.sm,
          padding: theme.spacing.sm,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceAlt,
        },
      ]}
    >
      <Ionicons name="medkit-outline" size={18} color={theme.colors.danger} />
      <Text variant="caption" style={styles.flex}>
        Pain or an injury came up. This isn’t medical advice: stop the movement that hurts and see a
        physiotherapist or doctor.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
});
