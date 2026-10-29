import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ErrorState, LoadingState, Text } from '@/components/ui';
import { useMeasurements } from '@/hooks/useBody';
import { usePhotos } from '@/hooks/usePhotos';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import type { Measurement } from '@/lib/api/body';
import { bodyValue, shortDate } from '@/lib/progress/series';

/** Two progress photos side by side, older on the left, with the bodyweight logged closest to each date. */
export default function ComparePhotosScreen() {
  const theme = useTheme();
  const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
  const { data: photos, isPending, error, refetch } = usePhotos();
  const { data: measurements } = useMeasurements();
  const unit = useProfile().data?.units ?? 'kg';

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const pair = [a, b]
    .map((id) => photos?.find((p) => p.id === id))
    .filter((p) => p !== undefined)
    .sort((x, y) => x.taken_on.localeCompare(y.taken_on));
  if (pair.length !== 2) return <ErrorState title="Photos not found" />;

  const weightNear = (date: string) => {
    let best: Measurement | null = null;
    for (const m of measurements ?? []) {
      if (m.bodyweight_kg == null) continue;
      const d = Math.abs(Date.parse(m.measured_on) - Date.parse(date));
      if (!best || d < Math.abs(Date.parse(best.measured_on) - Date.parse(date))) best = m;
    }
    return best && Math.abs(Date.parse(best.measured_on) - Date.parse(date)) <= 14 * 86400e3
      ? `${bodyValue(best.bodyweight_kg!, 'weight', unit)} ${unit}`
      : null;
  };
  const days = Math.round(
    (Date.parse(pair[1]!.taken_on) - Date.parse(pair[0]!.taken_on)) / 86400e3,
  );

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.background,
          padding: theme.spacing.md,
          gap: theme.spacing.md,
        },
      ]}
    >
      <Stack.Screen options={{ title: 'Compare' }} />
      <Text variant="label" color="textMuted" style={styles.center}>
        {days} day{days === 1 ? '' : 's'} apart
      </Text>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {pair.map((p) => (
          <View key={p.id} style={[styles.side, { gap: theme.spacing.xs }]}>
            <View
              style={[
                styles.frame,
                { borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
              ]}
            >
              {p.url ? (
                <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
            </View>
            <Text variant="label" style={styles.center}>
              {shortDate(p.taken_on)} {p.taken_on.slice(0, 4)}
            </Text>
            <Text variant="caption" color="textMuted" style={styles.center}>
              {[p.pose, weightNear(p.taken_on)].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row' },
  side: { flex: 1 },
  frame: { width: '100%', aspectRatio: 3 / 4, overflow: 'hidden' },
  center: { textAlign: 'center' },
});
