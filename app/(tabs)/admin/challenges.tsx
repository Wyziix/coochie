import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import {
  Button,
  Card,
  Chip,
  ErrorState,
  Input,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useExercises } from '@/hooks/useExercises';
import {
  useAdminBadges,
  useAdminChallenges,
  useSaveChallenge,
  useSetChallengeHidden,
} from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { Challenge, ChallengeMetric } from '@/lib/api/social';
import { describeError } from '@/lib/errors';
import { madridDate, metricLabels, timeLeft } from '@/lib/social/challenges';

const metrics: { value: ChallengeMetric; label: string }[] = [
  { value: 'workouts', label: 'Workouts' },
  { value: 'sets', label: 'Sets' },
  { value: 'points', label: 'Points' },
  { value: 'exercise', label: 'Exercise' },
];

/** Admin → Challenges: global (monthly) challenges for everyone. Logged. */
export default function AdminChallengesScreen() {
  const theme = useTheme();
  const list = useAdminChallenges();
  const hide = useSetChallengeHidden();
  const [editing, setEditing] = useState<Challenge | 'new' | null>(null);

  if (list.isPending) return <LoadingState />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      {editing ? (
        <ChallengeForm
          challenge={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Button title="New global challenge" onPress={() => setEditing('new')} fullWidth />
      )}
      {list.data.map((c) => (
        <Card key={c.id} style={{ opacity: c.is_hidden ? 0.6 : 1 }}>
          <Text variant="label">{c.title}</Text>
          <Text variant="caption" color="textMuted">
            {metricLabels[c.metric]}
            {c.exercise ? `: ${c.exercise}` : ''} · {c.start_date} to {c.end_date} · {timeLeft(c)} ·{' '}
            {c.participants} joined
            {c.reward_points ? ` · winner +${c.reward_points} pts` : ''}
          </Text>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            {c.state !== 'finished' ? (
              <Button
                title="Edit"
                variant="ghost"
                onPress={() => setEditing(c)}
                accessibilityLabel={`Edit ${c.title}`}
              />
            ) : null}
            <View style={styles.flex} />
            <Text variant="caption" color="textMuted">
              Hidden
            </Text>
            <Switch
              value={!!c.is_hidden}
              onValueChange={(v) => hide.mutate({ id: c.id, hidden: v })}
              accessibilityLabel={`Hide ${c.title}`}
              aria-checked={!!c.is_hidden}
              trackColor={{ true: theme.colors.danger, false: theme.colors.surfaceAlt }}
            />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

function ChallengeForm({ challenge, onDone }: { challenge: Challenge | null; onDone: () => void }) {
  const theme = useTheme();
  const save = useSaveChallenge();
  const exercises = useExercises().data ?? [];
  const badges = useAdminBadges().data ?? [];
  const firstOfNext = (() => {
    const today = madridDate(0);
    const [y, m] = today.split('-').map(Number) as [number, number];
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)] as const;
  })();
  const [title, setTitle] = useState(challenge?.title ?? '');
  const [description, setDescription] = useState(challenge?.description ?? '');
  const [metric, setMetric] = useState<ChallengeMetric>(challenge?.metric ?? 'workouts');
  const [exerciseId, setExerciseId] = useState<string | null>(challenge?.exercise_id ?? null);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [goal, setGoal] = useState(challenge?.goal ? String(challenge.goal) : '');
  const [start, setStart] = useState(challenge?.start_date ?? firstOfNext[0]);
  const [end, setEnd] = useState(challenge?.end_date ?? firstOfNext[1]);
  const [reward, setReward] = useState(String(challenge?.reward_points ?? 100));
  const [badgeId, setBadgeId] = useState<string | null>(null);
  const matches =
    exerciseQuery.trim().length >= 2
      ? exercises
          .filter((e) => e.name.toLowerCase().includes(exerciseQuery.trim().toLowerCase()))
          .slice(0, 6)
      : [];

  function submit() {
    save.mutate(
      {
        id: challenge?.id ?? null,
        input: {
          title: title.trim(),
          description: description.trim() || null,
          metric,
          exercise_id: metric === 'exercise' ? exerciseId : null,
          goal: goal ? Number(goal) : null,
          start_date: start,
          end_date: end,
          reward_points: Number(reward) || 0,
          reward_badge_id: badgeId,
        },
      },
      { onSuccess: onDone },
    );
  }

  return (
    <Card>
      <Text variant="heading">
        {challenge ? `Edit “${challenge.title}”` : 'New global challenge'}
      </Text>
      <Input
        label="Title"
        value={title}
        onChangeText={setTitle}
        maxLength={60}
        placeholder="e.g. Most workouts in December"
      />
      <Input
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        maxLength={300}
      />
      <SegmentedControl
        options={metrics}
        value={metric}
        onChange={setMetric}
        accessibilityLabel="Metric"
      />
      {metric === 'exercise' ? (
        <>
          <Input
            label="Exercise"
            value={exerciseQuery}
            onChangeText={setExerciseQuery}
            placeholder="Search"
          />
          {exerciseId ? (
            <Text>Chosen: {exercises.find((e) => e.id === exerciseId)?.name}</Text>
          ) : null}
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
        </>
      ) : null}
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View style={styles.flex}>
          <Input label="Start" value={start} onChangeText={setStart} autoCapitalize="none" />
        </View>
        <View style={styles.flex}>
          <Input label="End" value={end} onChangeText={setEnd} autoCapitalize="none" />
        </View>
      </View>
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View style={styles.flex}>
          <Input
            label="Goal (optional)"
            value={goal}
            onChangeText={setGoal}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.flex}>
          <Input
            label="Winner points"
            value={reward}
            onChangeText={setReward}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <Text variant="label">Winner badge (optional)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {badges
          .filter((b) => b.rule_type === 'manual' || b.category === 'challenge')
          .map((b) => (
            <Chip
              key={b.id}
              label={b.name}
              selected={badgeId === b.id}
              onPress={() => setBadgeId(badgeId === b.id ? null : b.id)}
            />
          ))}
      </View>
      <Text variant="caption" color="textMuted">
        Ends at midnight after the end date, Madrid time. Everyone can join; the winner gets the
        reward automatically.
      </Text>
      {save.error ? <Text color="danger">{describeError(save.error).message}</Text> : null}
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Button title="Save challenge" onPress={submit} loading={save.isPending} />
        <Button title="Cancel" variant="ghost" onPress={onDone} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
