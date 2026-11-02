import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';

import { OfflineNote } from '@/components/social/OfflineNote';
import { Button, Card, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import { useMarkRead, useNotifications } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import { useIsOnline } from '@/lib/offline/network';
import { timeAgo } from '@/lib/points/format';

/** The in-app inbox (iPhone web app and Android alike). */
export default function NotificationsScreen() {
  const theme = useTheme();
  const list = useNotifications();
  const markRead = useMarkRead();
  const online = useIsOnline();

  useEffect(() => {
    list.refetch();
    // Refresh once when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (list.isPending) return <LoadingState />;
  if (list.error && !list.data)
    return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text color="textMuted" style={{ flex: 1 }}>
          {unread ? `${unread} new` : 'All caught up'}
        </Text>
        {unread ? (
          <Button
            title="Mark all read"
            variant="ghost"
            onPress={() => markRead.mutate(undefined)}
            disabled={!online}
          />
        ) : null}
      </View>
      <OfflineNote updatedAt={list.dataUpdatedAt} />
      {items.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="No notifications"
          message="Friend requests, challenge invites and reminders show up here."
        />
      ) : (
        items.map((n) => (
          <Card
            key={n.id}
            onPress={() => {
              if (!n.read_at && online) markRead.mutate([n.id]);
              if (n.data?.url) router.push(n.data.url as never);
            }}
            accessibilityLabel={`${n.read_at ? '' : 'New: '}${n.title}. ${n.body}`}
          >
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
              {!n.read_at ? (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.primary,
                  }}
                />
              ) : null}
              <Text variant="label" style={{ flex: 1 }}>
                {n.title}
              </Text>
              <Text variant="caption" color="textMuted">
                {timeAgo(n.created_at)}
              </Text>
            </View>
            <Text color="textMuted">{n.body}</Text>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
