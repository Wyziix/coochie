import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FeedItemCard } from '@/components/social/FeedItemCard';
import { OfflineNote } from '@/components/social/OfflineNote';
import { EmptyState, ErrorState, Header, LoadingState, Screen, Text } from '@/components/ui';
import { useFeed, useFriends, useUnreadCount } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';

type Shortcut = {
  title: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  href: Href;
  count?: number;
};

/** Friends' activity, plus the way to friends, challenges, badges and the inbox. */
export default function SocialScreen() {
  const theme = useTheme();
  const feed = useFeed();
  const unread = useUnreadCount().data ?? 0;
  const incoming = useFriends().data?.incoming.length ?? 0;

  const shortcuts: Shortcut[] = [
    { title: 'Inbox', icon: 'notifications-outline', href: '/notifications', count: unread },
    { title: 'Friends', icon: 'people-outline', href: '/friends', count: incoming },
    { title: 'Challenges', icon: 'flag-outline', href: '/challenges' },
    { title: 'Badges', icon: 'ribbon-outline', href: '/badges' },
  ];

  return (
    <Screen scroll header={<Header title="Social" subtitle="Your friends’ training" />}>
      <View style={[styles.grid, { gap: theme.spacing.sm }]}>
        {shortcuts.map((s) => (
          <Pressable
            key={s.title}
            accessibilityRole="button"
            accessibilityLabel={s.count ? `${s.title}, ${s.count} new` : s.title}
            onPress={() => router.push(s.href)}
            style={[
              styles.tile,
              {
                gap: theme.spacing.xs,
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Ionicons name={s.icon} size={24} color={theme.colors.primary} />
            <Text variant="label">{s.title}</Text>
            {s.count ? (
              <View
                style={[
                  styles.count,
                  { backgroundColor: theme.colors.danger, borderRadius: theme.radius.full },
                ]}
              >
                <Text variant="caption" color="onDanger">
                  {s.count > 99 ? '99+' : s.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>

      <OfflineNote updatedAt={feed.data ? feed.dataUpdatedAt : undefined} />
      {feed.isPending ? (
        <LoadingState />
      ) : feed.error && !feed.data ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : feed.data?.length ? (
        feed.data.map((item) => <FeedItemCard key={item.id} item={item} />)
      ) : (
        <EmptyState
          icon="people-outline"
          title="Nothing here yet"
          message="Add friends to see their workouts, PRs and badges. Your own show up here too."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { flexGrow: 1, flexBasis: 140, borderWidth: StyleSheet.hairlineWidth, minHeight: 80 },
  count: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 22,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
});
