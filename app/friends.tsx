import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { NeedsConnectionNote, OfflineNote } from '@/components/social/OfflineNote';
import { UserRow } from '@/components/social/UserRow';
import { Button, Card, ErrorState, Input, LoadingState, Text } from '@/components/ui';
import { useFriendAction, useFriends, useUserSearch, type FriendAction } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { Relation } from '@/lib/api/social';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

/** Find people by username, requests, friends, blocked users. */
export default function FriendsScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const [query, setQuery] = useState('');
  const search = useUserSearch(query);
  const friends = useFriends();
  const act = useFriendAction();

  async function run(action: FriendAction, userId: string, username: string) {
    if (action === 'remove' || action === 'block') {
      const ok = await confirm({
        title: action === 'block' ? `Block ${username}?` : `Remove ${username}?`,
        message:
          action === 'block'
            ? 'They won’t be able to find you or send you requests, and you stop being friends.'
            : 'You stop seeing each other’s activity.',
        confirmLabel: action === 'block' ? 'Block' : 'Remove',
        destructive: true,
      });
      if (!ok) return;
    }
    act.mutate({ action, userId });
  }

  const btn = (
    title: string,
    action: FriendAction,
    userId: string,
    username: string,
    variant: 'primary' | 'secondary' | 'ghost' = 'secondary',
  ) => (
    <Button
      key={title}
      title={title}
      variant={variant}
      disabled={!online || act.isPending}
      onPress={() => run(action, userId, username)}
      accessibilityLabel={`${title} ${username}`}
    />
  );
  const actionsFor = (relation: Relation, userId: string, username: string) => {
    switch (relation) {
      case 'none':
        return btn('Add', 'add', userId, username, 'primary');
      case 'outgoing':
        return btn('Cancel', 'remove', userId, username, 'ghost');
      case 'incoming':
        return btn('Accept', 'accept', userId, username, 'primary');
      case 'friends':
        return (
          <Text variant="caption" color="textMuted">
            Friends
          </Text>
        );
      default:
        return null;
    }
  };

  const data = friends.data;
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: theme.spacing.sm }}>
        <Input
          label="Find friends by username"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. anna"
          editable={online}
        />
        <NeedsConnectionNote />
        {query.trim().length >= 2 && online ? (
          search.isPending ? (
            <LoadingState />
          ) : search.data?.length ? (
            search.data.map((u) => (
              <UserRow key={u.user_id} user={u}>
                {actionsFor(u.relation, u.user_id, u.username)}
              </UserRow>
            ))
          ) : (
            <Text color="textMuted">Nobody found with “{query.trim()}”.</Text>
          )
        ) : null}
        {act.error ? <Text color="danger">{describeError(act.error).message}</Text> : null}
      </View>

      <OfflineNote updatedAt={data ? friends.dataUpdatedAt : undefined} />
      {friends.isPending ? (
        <LoadingState />
      ) : friends.error && !data ? (
        <ErrorState error={friends.error} onRetry={() => friends.refetch()} />
      ) : data ? (
        <>
          {data.incoming.length ? (
            <Card>
              <Text variant="heading">Requests</Text>
              {data.incoming.map((u) => (
                <UserRow key={u.user_id} user={u}>
                  {btn('Accept', 'accept', u.user_id, u.username, 'primary')}
                  {btn('Decline', 'decline', u.user_id, u.username, 'ghost')}
                </UserRow>
              ))}
            </Card>
          ) : null}
          <Card>
            <Text variant="heading">Friends ({data.friends.length})</Text>
            {data.friends.length ? (
              data.friends.map((u) => (
                <UserRow key={u.user_id} user={u}>
                  {btn('Remove', 'remove', u.user_id, u.username, 'ghost')}
                </UserRow>
              ))
            ) : (
              <Text color="textMuted">No friends yet. Search for their username above.</Text>
            )}
          </Card>
          {data.outgoing.length ? (
            <Card>
              <Text variant="heading">Sent</Text>
              {data.outgoing.map((u) => (
                <UserRow key={u.user_id} user={u} note="Waiting">
                  {btn('Cancel', 'remove', u.user_id, u.username, 'ghost')}
                </UserRow>
              ))}
            </Card>
          ) : null}
          {data.blocked.length ? (
            <Card>
              <Text variant="heading">Blocked</Text>
              {data.blocked.map((u) => (
                <View key={u.user_id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ flex: 1 }}>{u.username}</Text>
                  {btn('Unblock', 'unblock', u.user_id, u.username, 'ghost')}
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
