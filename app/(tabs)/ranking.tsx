import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProgressBar } from '@/components/points/ProgressBar';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useLeaderboard, useMyPoints } from '@/hooks/usePoints';
import { useTheme } from '@/hooks/useTheme';
import type { LeaderboardEntry, Period } from '@/lib/api/points';
import { useIsOnline } from '@/lib/offline/network';
import { timeAgo } from '@/lib/points/format';
import { levelProgress } from '@/lib/points/labels';

const periods: { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
];

const emptyText: Record<Period, string> = {
  week: 'No points this week yet. The weekly board starts again every Monday (Madrid time).',
  month: 'No points this month yet.',
  all: 'No points yet. Finish a workout to get on the board.',
};

/** Public leaderboards: username, avatar, level and points only. */
export default function RankingScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const [period, setPeriod] = useState<Period>('week');
  const board = useLeaderboard(period);
  const mine = useMyPoints().data;
  const data = board.data;
  const me = data?.me;
  const meInList = data?.entries.some((e) => e.is_me);

  return (
    <Screen
      scroll
      header={
        <Header title="Ranking" subtitle="Points reward training regularly, not lifting the most" />
      }
    >
      {mine ? (
        <Card onPress={() => router.push('/points')} accessibilityLabel="Your level and points">
          <View style={styles.row}>
            <Text variant="heading" style={styles.flex}>
              Level {mine.level.level} · {mine.level.name}
            </Text>
            <Text variant="label">{mine.total.toLocaleString()} pts</Text>
          </View>
          <ProgressBar
            value={levelProgress(mine.level)}
            label={`Progress to level ${mine.level.level + 1}`}
          />
        </Card>
      ) : null}

      <SegmentedControl
        options={periods}
        value={period}
        onChange={setPeriod}
        accessibilityLabel="Leaderboard period"
      />

      {!online && data ? (
        <Text variant="caption" color="textMuted">
          Offline, last updated {timeAgo(board.dataUpdatedAt)}.
        </Text>
      ) : null}

      {board.isPending ? (
        <LoadingState />
      ) : board.error && !data ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      ) : data ? (
        <>
          {me ? (
            <Card accessibilityLabel="Your rank">
              <Text variant="label" color="textMuted">
                You
              </Text>
              {me.removed ? (
                <Text>
                  You’re not shown on public leaderboards. Your points still count for your level.
                </Text>
              ) : me.rank ? (
                <Text variant="heading">
                  #{me.rank} · {me.points.toLocaleString()} points
                </Text>
              ) : (
                <Text>{period === 'week' ? 'No points this week yet.' : 'No points yet.'}</Text>
              )}
              {me.hidden && !me.removed ? (
                <Text variant="caption" color="textMuted">
                  You’re hidden from public leaderboards, so others don’t see you
                  {me.rank ? `; you’d be #${me.rank}` : ''}. Change it in Profile.
                </Text>
              ) : null}
            </Card>
          ) : null}

          {data.entries.length === 0 ? (
            <EmptyState icon="trophy-outline" title="Nobody here yet" message={emptyText[period]} />
          ) : (
            <Card style={{ gap: 0, paddingVertical: theme.spacing.xs }}>
              {data.entries.map((e) => (
                <Row key={`${e.rank}-${e.username}`} entry={e} />
              ))}
            </Card>
          )}
          {me && !meInList && me.rank && !me.hidden ? (
            <Text variant="caption" color="textMuted">
              You’re #{me.rank}, outside the top {data.entries.length}.
            </Text>
          ) : null}
          {period === 'week' ? (
            <Text variant="caption" color="textMuted">
              The weekly board resets every Monday at 00:00, Madrid time.
            </Text>
          ) : null}
        </>
      ) : null}

      <Card accessibilityLabel="Friends leaderboard, coming soon">
        <Text variant="label">Friends</Text>
        <Text variant="caption" color="textMuted">
          A leaderboard with just your friends is coming with friends and challenges.
        </Text>
      </Card>
    </Screen>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.xs,
          borderRadius: theme.radius.md,
          backgroundColor: entry.is_me ? theme.colors.surfaceAlt : undefined,
        },
      ]}
      accessibilityLabel={`Rank ${entry.rank}, ${entry.username}${entry.is_me ? ' (you)' : ''}, level ${entry.level}, ${entry.points} points`}
    >
      <Text variant="label" color={entry.rank <= 3 ? 'primary' : 'textMuted'} style={styles.rank}>
        {entry.rank}
      </Text>
      <Avatar uri={entry.avatar_url} name={entry.username} size={36} />
      <View style={styles.flex}>
        <Text variant="label" numberOfLines={1}>
          {entry.username}
          {entry.is_me ? ' (you)' : ''}
        </Text>
        <Text variant="caption" color="textMuted">
          Level {entry.level}
        </Text>
      </View>
      <Text variant="label">{entry.points.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  rank: { width: 28, textAlign: 'center' },
});
