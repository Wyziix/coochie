import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { ProgressBar } from '@/components/points/ProgressBar';
import { NeedsConnectionNote, OfflineNote } from '@/components/social/OfflineNote';
import { Button, Card, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import { useChallengeStatus, useChallenges } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { Challenge } from '@/lib/api/social';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { metricLabels, scoreLabel, timeLeft } from '@/lib/social/challenges';

/** Global monthly challenges and friend challenges, with invites. */
export default function ChallengesScreen() {
  const theme = useTheme();
  const list = useChallenges();
  const online = useIsOnline();
  const status = useChallengeStatus();

  if (list.isPending) return <LoadingState />;
  if (list.error && !list.data)
    return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const all = list.data ?? [];
  const invites = all.filter((c) => c.my_status === 'invited' && c.state !== 'finished');
  const current = all.filter((c) => c.state !== 'finished' && c.my_status !== 'invited');
  const finished = all.filter((c) => c.state === 'finished');

  const card = (c: Challenge) => (
    <View key={c.id} style={{ gap: theme.spacing.xs }}>
      <Card
        onPress={() => router.push({ pathname: '/challenges/[id]', params: { id: c.id } })}
        accessibilityLabel={`${c.title}, ${timeLeft(c)}`}
      >
        <Text variant="label">{c.title}</Text>
        <Text variant="caption" color="textMuted">
          {c.kind === 'global' ? 'Everyone' : `With friends · by ${c.created_by}`} ·{' '}
          {metricLabels[c.metric]}
          {c.exercise ? `: ${c.exercise}` : ''} · {timeLeft(c)} · {c.participants} in
        </Text>
        {c.my_status === 'joined' ? (
          <>
            {c.goal ? (
              <ProgressBar value={(c.my_score ?? 0) / c.goal} label={`${c.title} progress`} />
            ) : null}
            <Text variant="caption">
              You: {scoreLabel(c, c.my_score)}
              {c.goal ? ` of ${c.goal}` : ''}
            </Text>
          </>
        ) : null}
      </Card>
      {c.my_status === 'invited' ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Button
            title="Accept"
            onPress={() => status.mutate({ id: c.id, status: 'joined' })}
            disabled={!online}
            accessibilityLabel={`Accept ${c.title}`}
          />
          <Button
            title="Decline"
            variant="ghost"
            onPress={() => status.mutate({ id: c.id, status: 'declined' })}
            disabled={!online}
            accessibilityLabel={`Decline ${c.title}`}
          />
        </View>
      ) : c.kind === 'global' && !c.my_status && c.state !== 'finished' ? (
        <Button
          title="Join"
          variant="secondary"
          onPress={() => status.mutate({ id: c.id, status: 'joined' })}
          disabled={!online}
          accessibilityLabel={`Join ${c.title}`}
        />
      ) : null}
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Button
        title="New friend challenge"
        onPress={() => router.push('/challenges/new')}
        disabled={!online}
        fullWidth
      />
      <NeedsConnectionNote />
      <OfflineNote updatedAt={list.dataUpdatedAt} />
      {status.error ? <Text color="danger">{describeError(status.error).message}</Text> : null}
      {invites.length ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Invites</Text>
          {invites.map(card)}
        </View>
      ) : null}
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="heading">Now</Text>
        {current.length ? (
          current.map(card)
        ) : (
          <EmptyState
            icon="flag-outline"
            title="No challenges right now"
            message="Start one with your friends."
          />
        )}
      </View>
      {finished.length ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Finished</Text>
          {finished.map(card)}
        </View>
      ) : null}
      <Text variant="caption" color="textMuted">
        Challenges end at midnight, Madrid time. Scores count workouts that earned points.
      </Text>
    </ScrollView>
  );
}
