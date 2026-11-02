import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ProgressBar } from '@/components/points/ProgressBar';
import { OfflineNote } from '@/components/social/OfflineNote';
import { Card, ErrorState, LoadingState, Text } from '@/components/ui';
import { useMyBadges } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { Badge } from '@/lib/api/social';

const sections: { category: Badge['category']; title: string }[] = [
  { category: 'milestone', title: 'Milestones' },
  { category: 'consistency', title: 'Consistency' },
  { category: 'strength', title: 'Strength (relative to your bodyweight)' },
  { category: 'fun', title: 'Fun' },
  { category: 'challenge', title: 'Challenges' },
];

/** All badges: earned ones with the date, locked ones with progress. */
export default function BadgesScreen() {
  const theme = useTheme();
  const badges = useMyBadges();
  if (badges.isPending) return <LoadingState />;
  if (badges.error && !badges.data)
    return <ErrorState error={badges.error} onRetry={() => badges.refetch()} />;
  const list = badges.data ?? [];
  const earned = list.filter((b) => b.earned_at).length;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Text color="textMuted">
        {earned} of {list.length} earned. Strength badges compare with your bodyweight, so they’re
        fair for everyone.
      </Text>
      <OfflineNote updatedAt={badges.dataUpdatedAt} />
      {sections.map((s) => {
        const items = list.filter((b) => b.category === s.category);
        if (!items.length) return null;
        return (
          <View key={s.category} style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{s.title}</Text>
            <View style={[styles.grid, { gap: theme.spacing.sm }]}>
              {items.map((b) => (
                <BadgeTile key={b.id} badge={b} />
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function BadgeTile({ badge: b }: { badge: Badge }) {
  const theme = useTheme();
  const unlocked = !!b.earned_at;
  const p = b.progress;
  const pct = p && p.target ? Math.min(1, p.current / p.target) : 0;
  return (
    <Card
      style={[styles.tile, { opacity: unlocked ? 1 : 0.7 }]}
      accessibilityLabel={`${b.name}, ${unlocked ? 'earned' : 'locked'}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons
          name={(unlocked ? b.icon : 'lock-closed-outline') as 'ribbon'}
          size={28}
          color={unlocked ? theme.colors.primary : theme.colors.textMuted}
        />
        <Text variant="label" style={{ flex: 1 }}>
          {b.name}
        </Text>
      </View>
      <Text variant="caption" color="textMuted">
        {b.description}
      </Text>
      {unlocked ? (
        <Text variant="caption" color="success">
          Earned{' '}
          {new Date(b.earned_at!).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </Text>
      ) : p && p.target ? (
        <>
          <ProgressBar value={pct} label={`${b.name} progress`} />
          <Text variant="caption" color="textMuted">
            {Math.round(p.current * 10) / 10} / {Math.round(p.target * 10) / 10}
          </Text>
        </>
      ) : p && b.category === 'strength' ? (
        <Text variant="caption" color="textMuted">
          Add your bodyweight in Profile to track this.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { flexGrow: 1, flexBasis: 220 },
});
