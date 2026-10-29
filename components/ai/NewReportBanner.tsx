import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { useUnseenReports } from '@/hooks/useAi';
import { useTheme } from '@/hooks/useTheme';
import { weekLabel } from '@/lib/ai/format';

/** Home: "New weekly report" until it's opened (the badge on iPhone, where there's no push). */
export function NewReportBanner() {
  const theme = useTheme();
  const unseen = useUnseenReports();
  const latest = unseen[0];
  if (!latest) return null;
  return (
    <Card
      onPress={() => router.push({ pathname: '/reports/[id]', params: { id: latest.id } })}
      accessibilityLabel={`New weekly report, ${weekLabel(latest.week_start)}`}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <Ionicons name="sparkles" size={22} color={theme.colors.primary} />
        <View style={styles.flex}>
          <Text variant="label">New weekly report</Text>
          <Text variant="caption" color="textMuted">
            {weekLabel(latest.week_start)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
