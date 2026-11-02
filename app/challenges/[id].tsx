import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { ProgressBar } from '@/components/points/ProgressBar';
import { NeedsConnectionNote, OfflineNote } from '@/components/social/OfflineNote';
import { UserRow } from '@/components/social/UserRow';
import { Button, Card, ErrorState, LoadingState, Text } from '@/components/ui';
import {
  useChallenge,
  useChallengeStatus,
  useFriends,
  useInviteToChallenge,
} from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { metricLabels, scoreLabel, timeLeft } from '@/lib/social/challenges';

/** Progress, live ranking, final results. */
export default function ChallengeScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const challenge = useChallenge(id);
  const status = useChallengeStatus();
  const invite = useInviteToChallenge();
  const friends = useFriends().data?.friends ?? [];
  const online = useIsOnline();

  if (challenge.isPending) return <LoadingState />;
  if (challenge.error && !challenge.data)
    return <ErrorState error={challenge.error} onRetry={() => challenge.refetch()} />;
  const c = challenge.data!;
  const ranking = c.ranking ?? [];
  const inIds = new Set(ranking.map((r) => r.user_id));
  const canInvite = c.is_mine && c.kind === 'friend' && c.state !== 'finished';
  const winners = ranking.filter((r) => r.winner);

  async function leave() {
    const ok = await confirm({
      title: 'Leave this challenge?',
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (ok) status.mutate({ id: c.id, status: 'declined' });
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Stack.Screen options={{ title: c.title }} />
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{c.title}</Text>
        <Text color="textMuted">
          {metricLabels[c.metric]}
          {c.exercise ? `: ${c.exercise}` : ''} · {c.start_date} to {c.end_date} · {timeLeft(c)}
        </Text>
        {c.description ? <Text>{c.description}</Text> : null}
        {c.reward_points || c.reward_badge ? (
          <Text variant="caption" color="textMuted">
            Winner gets{' '}
            {[
              c.reward_points ? `${c.reward_points} points` : null,
              c.reward_badge ? `the “${c.reward_badge}” badge` : null,
            ]
              .filter(Boolean)
              .join(' and ')}
          </Text>
        ) : null}
      </View>
      <OfflineNote updatedAt={challenge.dataUpdatedAt} />

      {c.state === 'finished' && winners.length ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="trophy" size={28} color={theme.colors.warning} />
            <Text variant="heading" style={{ flex: 1 }}>
              {winners.some((w) => w.is_me)
                ? 'You won!'
                : `${winners.map((w) => w.username).join(' and ')} won`}
            </Text>
          </View>
        </Card>
      ) : null}

      {c.my_status === 'joined' ? (
        <Card>
          <Text variant="label">You: {scoreLabel(c, c.my_score)}</Text>
          {c.goal ? (
            <>
              <ProgressBar value={(c.my_score ?? 0) / c.goal} label="Your progress" />
              <Text variant="caption" color="textMuted">
                Goal: {c.goal}
              </Text>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Text variant="heading">{c.state === 'finished' ? 'Final results' : 'Ranking'}</Text>
        {ranking
          .filter((r) => r.status === 'joined')
          .map((r) => (
            <UserRow key={r.user_id} user={r} note={scoreLabel(c, r.score)}>
              <Text
                variant="label"
                color={r.winner ? 'warning' : r.is_me ? 'primary' : 'textMuted'}
              >
                {r.winner ? '🏆 ' : ''}#{r.rank}
              </Text>
            </UserRow>
          ))}
        {ranking.some((r) => r.status === 'invited') ? (
          <Text variant="caption" color="textMuted">
            Invited:{' '}
            {ranking
              .filter((r) => r.status === 'invited')
              .map((r) => r.username)
              .join(', ')}
          </Text>
        ) : null}
      </Card>

      {c.state !== 'finished' ? (
        <View style={{ gap: theme.spacing.sm }}>
          {c.my_status === 'invited' ? (
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Button
                title="Accept"
                onPress={() => status.mutate({ id: c.id, status: 'joined' })}
                disabled={!online}
              />
              <Button
                title="Decline"
                variant="ghost"
                onPress={() => status.mutate({ id: c.id, status: 'declined' })}
                disabled={!online}
              />
            </View>
          ) : !c.my_status && c.kind === 'global' ? (
            <Button
              title="Join"
              onPress={() => status.mutate({ id: c.id, status: 'joined' })}
              disabled={!online}
              fullWidth
            />
          ) : c.my_status === 'joined' && !c.is_mine ? (
            <Button title="Leave" variant="ghost" onPress={leave} disabled={!online} />
          ) : null}
          <NeedsConnectionNote />
          {status.error ? <Text color="danger">{describeError(status.error).message}</Text> : null}
        </View>
      ) : null}

      {canInvite && friends.some((f) => !inIds.has(f.user_id)) ? (
        <Card>
          <Text variant="heading">Invite more friends</Text>
          {friends
            .filter((f) => !inIds.has(f.user_id))
            .map((f) => (
              <UserRow key={f.user_id} user={f}>
                <Button
                  title="Invite"
                  variant="secondary"
                  onPress={() =>
                    invite.mutate(
                      { id: c.id, userId: f.user_id },
                      { onSuccess: () => challenge.refetch() },
                    )
                  }
                  disabled={!online || invite.isPending}
                  accessibilityLabel={`Invite ${f.username}`}
                />
              </UserRow>
            ))}
          {invite.error ? <Text color="danger">{describeError(invite.error).message}</Text> : null}
        </Card>
      ) : null}
    </ScrollView>
  );
}
