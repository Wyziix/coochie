import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { FeedItemCard } from '@/components/social/FeedItemCard';
import { NeedsConnectionNote, OfflineNote } from '@/components/social/OfflineNote';
import { ReportSheet } from '@/components/social/ReportSheet';
import { Avatar, Button, Card, ErrorState, LoadingState, Text } from '@/components/ui';
import { useFriendAction, useUserProfile, type FriendAction } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

/** Someone's page: username, avatar, level, streak, badges; activity for friends. */
export default function UserScreen() {
  const theme = useTheme();
  const { username } = useLocalSearchParams<{ username: string }>();
  const profile = useUserProfile(username);
  const act = useFriendAction();
  const online = useIsOnline();
  const [reporting, setReporting] = useState(false);

  if (profile.isPending) return <LoadingState />;
  if (profile.error && !profile.data)
    return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  const p = profile.data!;

  async function run(action: FriendAction) {
    if (action === 'block' || action === 'remove') {
      const ok = await confirm({
        title: action === 'block' ? `Block ${p.username}?` : `Remove ${p.username} as a friend?`,
        message:
          action === 'block' ? 'They won’t be able to find you or send you requests.' : undefined,
        confirmLabel: action === 'block' ? 'Block' : 'Remove',
        destructive: true,
      });
      if (!ok) return;
    }
    act.mutate({ action, userId: p.user_id }, { onSuccess: () => profile.refetch() });
  }
  const b = (
    title: string,
    action: FriendAction,
    variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary',
  ) => (
    <Button
      key={title}
      title={title}
      variant={variant}
      onPress={() => run(action)}
      disabled={!online || act.isPending}
    />
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Stack.Screen options={{ title: p.username }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
        <Avatar uri={p.avatar_url} name={p.username} size={72} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">{p.username}</Text>
          <Text color="textMuted">Level {p.level}</Text>
          <Text variant="caption" color="textMuted">
            {p.streak.current} week streak · longest {p.streak.longest}
          </Text>
        </View>
      </View>
      <OfflineNote updatedAt={profile.dataUpdatedAt} />

      {p.relation !== 'me' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {p.relation === 'none' ? b('Add friend', 'add', 'primary') : null}
          {p.relation === 'incoming' ? b('Accept request', 'accept', 'primary') : null}
          {p.relation === 'incoming' ? b('Decline', 'decline') : null}
          {p.relation === 'outgoing' ? b('Cancel request', 'remove') : null}
          {p.relation === 'friends' ? b('Remove friend', 'remove') : null}
          {p.relation === 'blocked' ? b('Unblock', 'unblock') : b('Block', 'block', 'ghost')}
          {p.relation !== 'blocked' ? (
            <Button
              title="Report user"
              variant="ghost"
              onPress={() => setReporting(true)}
              disabled={!online}
            />
          ) : null}
        </View>
      ) : null}
      <NeedsConnectionNote />
      {act.error ? <Text color="danger">{describeError(act.error).message}</Text> : null}

      <Card>
        <Text variant="heading">Badges ({p.badges.length})</Text>
        {p.badges.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
            {p.badges.map((badge) => (
              <View key={badge.name} style={{ alignItems: 'center', width: 84, gap: 4 }}>
                <Ionicons name={badge.icon as 'ribbon'} size={28} color={theme.colors.primary} />
                <Text variant="caption" style={{ textAlign: 'center' }}>
                  {badge.name}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text color="textMuted">No badges yet.</Text>
        )}
      </Card>

      {p.activity ? (
        p.activity.length ? (
          p.activity.map((item) => <FeedItemCard key={item.id} item={item} />)
        ) : (
          <Text color="textMuted">No activity yet.</Text>
        )
      ) : p.activity_hidden ? (
        <Text color="textMuted">{p.username} doesn’t share their activity.</Text>
      ) : p.relation !== 'me' ? (
        <Text color="textMuted">Become friends to see each other’s workouts and PRs.</Text>
      ) : null}

      {p.relation !== 'me' ? (
        <ReportSheet
          visible={reporting}
          onClose={() => setReporting(false)}
          userId={p.user_id}
          username={p.username}
        />
      ) : null}
    </ScrollView>
  );
}
