import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useReact } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { FeedItem } from '@/lib/api/social';
import { useIsOnline } from '@/lib/offline/network';
import { timeAgo } from '@/lib/points/format';
import { formatWeight } from '@/lib/units';

import { ReportSheet } from './ReportSheet';
import { UserRow } from './UserRow';

export const EMOJIS = ['💪', '🔥', '👏', '🏆'] as const;

const metricWord: Record<string, string> = {
  workouts: 'workouts',
  sets: 'sets',
  points: 'points',
  exercise: 'sets',
};

export function describeFeedItem(item: FeedItem, unit: 'kg' | 'lbs'): string {
  const p = item.payload;
  switch (item.kind) {
    case 'workout':
      return `Finished ${p.name ?? 'a workout'} · ${p.minutes ?? 0} min, ${p.sets ?? 0} sets`;
    case 'pr':
      return p.weight_kg != null
        ? `New PR on ${p.exercise}: ${formatWeight(p.weight_kg, unit)}`
        : `New PR on ${p.exercise}`;
    case 'badge':
      return `Earned the “${p.badge}” badge`;
    case 'level_up':
      return `Reached level ${p.level}`;
    case 'challenge_win':
      return `Won “${p.challenge}”${p.score != null ? ` with ${p.score} ${metricWord[p.metric ?? ''] ?? ''}` : ''}`;
  }
}

const kindIcon: Record<
  FeedItem['kind'],
  'barbell-outline' | 'trending-up' | 'ribbon-outline' | 'star' | 'trophy'
> = {
  workout: 'barbell-outline',
  pr: 'trending-up',
  badge: 'ribbon-outline',
  level_up: 'star',
  challenge_win: 'trophy',
};

/** One feed entry with reactions (no comments). */
export function FeedItemCard({ item }: { item: FeedItem }) {
  const theme = useTheme();
  const unit = useProfile().data?.units ?? 'kg';
  const online = useIsOnline();
  const reactMutation = useReact();
  const [reporting, setReporting] = useState(false);
  const text = describeFeedItem(item, unit);

  return (
    <Card>
      <UserRow user={item.user} note={timeAgo(item.occurred_at)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name={kindIcon[item.kind]} size={20} color={theme.colors.primary} />
        <Text style={{ flex: 1 }}>{text}</Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.xs,
          flexWrap: 'wrap',
        }}
      >
        {EMOJIS.map((e) => {
          const mine = item.my_reaction === e;
          const n = item.reactions[e] ?? 0;
          return (
            <Pressable
              key={e}
              accessibilityRole="button"
              accessibilityLabel={`${mine ? 'Remove' : 'React'} ${e} on ${item.user.username}: ${text}`}
              aria-pressed={mine}
              aria-disabled={!online}
              disabled={!online || reactMutation.isPending}
              onPress={() => reactMutation.mutate({ id: item.id, emoji: mine ? null : e })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                minHeight: 36,
                paddingHorizontal: theme.spacing.sm,
                borderRadius: theme.radius.full,
                borderWidth: 1,
                borderColor: mine ? theme.colors.primary : theme.colors.border,
                backgroundColor: mine ? theme.colors.surfaceAlt : undefined,
                opacity: online ? 1 : 0.5,
              }}
            >
              <Text>{e}</Text>
              {n > 0 ? (
                <Text variant="caption" color="textMuted">
                  {n}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        {!item.is_mine ? (
          <Button
            title="Report"
            variant="ghost"
            onPress={() => setReporting(true)}
            disabled={!online}
            accessibilityLabel={`Report ${item.user.username}`}
          />
        ) : null}
      </View>
      {!item.is_mine ? (
        <ReportSheet
          visible={reporting}
          onClose={() => setReporting(false)}
          userId={item.user.user_id}
          username={item.user.username}
          activityId={item.id}
        />
      ) : null}
    </Card>
  );
}
