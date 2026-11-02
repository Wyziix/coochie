import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { NeedsConnection } from '@/components/offline/NeedsConnection';
import { Button, Chip, Input, SegmentedControl, Text } from '@/components/ui';
import { useExercises } from '@/hooks/useExercises';
import { useCreateFriendChallenge, useFriends } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { ChallengeMetric } from '@/lib/api/social';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { madridDate, metricLabels } from '@/lib/social/challenges';

const metrics: { value: ChallengeMetric; label: string }[] = [
  { value: 'workouts', label: 'Workouts' },
  { value: 'sets', label: 'Sets' },
  { value: 'points', label: 'Points' },
  { value: 'exercise', label: 'Exercise' },
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Friend challenge: metric, optional goal, dates, friends to invite. */
export default function NewChallengeScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const friends = useFriends().data?.friends ?? [];
  const exercises = useExercises().data ?? [];
  const create = useCreateFriendChallenge();
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState<ChallengeMetric>('workouts');
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState(madridDate(0));
  const [end, setEnd] = useState(madridDate(6));
  const [invite, setInvite] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (!online) return <NeedsConnection message="Creating a challenge needs a connection." />;

  const matches =
    exerciseQuery.trim().length >= 2
      ? exercises
          .filter(
            (e) =>
              !e.is_hidden && e.name.toLowerCase().includes(exerciseQuery.trim().toLowerCase()),
          )
          .slice(0, 8)
      : [];
  const chosen = exercises.find((e) => e.id === exerciseId);

  function submit() {
    setError(null);
    if (title.trim().length < 2) return setError('Give it a name.');
    if (!DATE.test(start) || !DATE.test(end)) return setError('Dates like 2026-11-30.');
    if (end < start) return setError('The end is before the start.');
    if (metric === 'exercise' && !exerciseId) return setError('Pick the exercise.');
    if (goal && !(Number(goal) > 0)) return setError('The goal must be a number above 0.');
    if (!invite.length) return setError('Invite at least one friend.');
    create.mutate(
      {
        input: {
          title: title.trim(),
          metric,
          exercise_id: metric === 'exercise' ? exerciseId : null,
          goal: goal ? Number(goal) : null,
          start_date: start,
          end_date: end,
        },
        invite,
      },
      { onSuccess: (id) => router.replace({ pathname: '/challenges/[id]', params: { id } }) },
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Input
        label="Name"
        value={title}
        onChangeText={setTitle}
        maxLength={60}
        placeholder="e.g. Most workouts this week"
      />
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">What counts</Text>
        <SegmentedControl
          options={metrics}
          value={metric}
          onChange={setMetric}
          accessibilityLabel="What counts"
        />
        <Text variant="caption" color="textMuted">
          {metricLabels[metric]}. Only workouts that earn points count.
        </Text>
      </View>
      {metric === 'exercise' ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Input
            label="Exercise"
            value={exerciseQuery}
            onChangeText={setExerciseQuery}
            placeholder="Search, e.g. bench"
          />
          {chosen ? <Text>Chosen: {chosen.name}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {matches.map((e) => (
              <Chip
                key={e.id}
                label={e.name}
                selected={e.id === exerciseId}
                onPress={() => setExerciseId(e.id)}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Input
        label="Goal (optional)"
        value={goal}
        onChangeText={setGoal}
        keyboardType="number-pad"
        hint="Shows a progress bar toward it."
      />
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <Input
            label="Start (YYYY-MM-DD)"
            value={start}
            onChangeText={setStart}
            autoCapitalize="none"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="End (YYYY-MM-DD)" value={end} onChangeText={setEnd} autoCapitalize="none" />
        </View>
      </View>
      <Text variant="caption" color="textMuted">
        It ends at midnight after the end date, Madrid time.
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">Invite friends</Text>
        {friends.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {friends.map((f) => (
              <Chip
                key={f.user_id}
                label={f.username}
                selected={invite.includes(f.user_id)}
                onPress={() =>
                  setInvite((list) =>
                    list.includes(f.user_id)
                      ? list.filter((x) => x !== f.user_id)
                      : [...list, f.user_id],
                  )
                }
              />
            ))}
          </View>
        ) : (
          <Text color="textMuted">Add friends first (Social → Friends).</Text>
        )}
      </View>
      {error || create.error ? (
        <Text color="danger">{error ?? describeError(create.error).message}</Text>
      ) : null}
      <Button title="Create challenge" onPress={submit} loading={create.isPending} fullWidth />
    </ScrollView>
  );
}
