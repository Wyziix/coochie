import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { WorkoutFeedbackCard } from '@/components/ai/WorkoutFeedbackCard';
import { BottomSheet, Button, Card, ErrorState, Input, LoadingState, Text } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import type { SyncMark } from '@/lib/offline/overlay';
import { useWorkoutRecords } from '@/hooks/useProgress';
import { useTemplateFromWorkout } from '@/hooks/useTemplates';
import { formatRecordValue, recordLabels } from '@/lib/progress/records';
import { useDeleteWorkout, useWorkout } from '@/hooks/useWorkouts';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { workoutForEditing } from '@/lib/workout/fromTemplate';
import { useEditWorkoutStore } from '@/stores/workoutStore';
import type { WorkoutDetail } from '@/lib/api/workouts';
import { setTypeLabels } from '@/lib/exercises/labels';
import { formatWeight, toDisplayWeight, type WeightUnit } from '@/lib/units';
import { formatDuration, formatDurationShort, metersToDisplay } from '@/lib/workout/format';

type SetRowData = WorkoutDetail['sets'][number];

function describeSet(s: SetRowData, unit: WeightUnit): string {
  const parts: string[] = [];
  if (s.reps != null) {
    parts.push(
      s.weight_kg != null && s.weight_kg > 0
        ? `${toDisplayWeight(s.weight_kg, unit)} ${unit} × ${s.reps}`
        : `${s.reps} reps`,
    );
  }
  if (s.duration_seconds != null) parts.push(formatDuration(s.duration_seconds));
  if (s.distance_m != null)
    parts.push(`${metersToDisplay(s.distance_m, unit)} ${unit === 'lbs' ? 'mi' : 'km'}`);
  if (s.rpe != null) parts.push(`RPE ${s.rpe}`);
  return parts.join(' · ');
}

export default function WorkoutSummaryScreen() {
  const theme = useTheme();
  const { id, finished } = useLocalSearchParams<{ id: string; finished?: string }>();
  const { data: workout, isPending, error, refetch } = useWorkout(id);
  const unit = useProfile().data?.units ?? 'kg';
  const remove = useDeleteWorkout();
  const records = useWorkoutRecords(id);
  const asTemplate = useTemplateFromWorkout();
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!workout) return <ErrorState title="Workout not found" message="It may have been deleted." />;
  const sync = (workout as SyncMark).sync;

  function edit() {
    useEditWorkoutStore.getState().load(workoutForEditing(workout!, unit));
    router.push({
      pathname: '/workouts/edit',
      params: {
        id: workout!.id,
        minutes: String(Math.max(1, Math.round(workout!.duration_seconds / 60))),
      },
    });
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Delete “${workout!.name}”?`,
      message: 'This can’t be undone. Totals and records are recalculated.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setActionError(null);
    remove.mutate(workout!, {
      onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/workout')),
      onError: (e) => setActionError(`Couldn’t delete: ${describeError(e).message}`),
    });
  }

  function saveAsTemplate() {
    const name = templateName?.trim();
    if (!name) return;
    asTemplate.mutate(
      { workout: workout!, name },
      {
        onSuccess: (t) => {
          setTemplateName(null);
          router.push({ pathname: '/templates/[id]', params: { id: t.id } });
        },
      },
    );
  }

  // Group sets by exercise block, keeping order.
  const blocks: { name: string; sets: SetRowData[] }[] = [];
  for (const s of workout.sets) {
    const last = blocks.at(-1);
    if (last && last.sets[0]!.exercise_order === s.exercise_order) last.sets.push(s);
    else blocks.push({ name: s.exercise.name, sets: [s] });
  }

  const stat = (label: string, value: string) => (
    <View style={styles.stat}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Stack.Screen options={{ title: finished ? 'Workout saved' : workout.name }} />
      <View style={{ gap: theme.spacing.xs }}>
        {finished ? (
          <Text variant="label" color="success">
            {sync ? 'Nice work. Saved on this device.' : 'Nice work. Saved.'}
          </Text>
        ) : null}
        {sync === 'waiting' ? (
          <Text variant="caption" color="textMuted">
            Waiting to sync. It’s sent automatically when you’re online; records are checked then.
          </Text>
        ) : sync === 'failed' ? (
          <Text variant="caption" color="danger" onPress={() => router.push('/sync')}>
            Couldn’t sync this workout. Tap to see why.
          </Text>
        ) : null}
        <Text variant="title">{workout.name}</Text>
        <Text color="textMuted">
          {new Date(workout.started_at).toLocaleString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>

      <Card style={styles.stats}>
        {stat('Duration', formatDurationShort(workout.duration_seconds))}
        {stat('Volume', formatWeight(workout.total_volume_kg, unit))}
        {stat('Sets', String(workout.sets.length))}
      </Card>

      {records.data?.length ? (
        <Card>
          <Text variant="label" color="success">
            {records.data.length} personal record{records.data.length === 1 ? '' : 's'}
          </Text>
          {records.data.map((rec) => (
            <Text key={`${rec.exercise_id}-${rec.record_type}-${rec.weight_kg}`} variant="caption">
              {rec.exercise_name}: {recordLabels[rec.record_type]} {formatRecordValue(rec, unit)}{' '}
              (was {formatRecordValue(rec, unit, rec.previous_value)})
            </Text>
          ))}
        </Card>
      ) : null}

      <WorkoutFeedbackCard
        workoutId={workout.id}
        waitingToSync={sync !== undefined}
        workoutUpdatedAt={workout.updated_at}
      />

      {blocks.map((block, i) => (
        <Card key={`${block.name}-${i}`}>
          <Text variant="heading">{block.name}</Text>
          {block.sets.map((s, j) => (
            <View key={s.id} style={styles.setLine}>
              <Text color="textMuted" style={styles.setNo}>
                {setTypeLabels[s.set_type].short || j + 1}
              </Text>
              <Text>{describeSet(s, unit)}</Text>
            </View>
          ))}
        </Card>
      ))}

      {finished ? (
        <Button title="Done" onPress={() => router.replace('/workout')} fullWidth />
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <Button title="Edit workout" variant="secondary" onPress={edit} />
        <Button
          title="Save as template"
          variant="secondary"
          onPress={() => setTemplateName(workout.name)}
        />
        <Button
          title="Delete workout"
          variant="ghost"
          onPress={onDelete}
          loading={remove.isPending}
        />
        {actionError ? <Text color="danger">{actionError}</Text> : null}
      </View>

      <BottomSheet
        visible={templateName !== null}
        onClose={() => setTemplateName(null)}
        title="Save as template"
      >
        <Text color="textMuted">
          Same exercises in the same order, with the sets and reps you did.
        </Text>
        <Input
          label="Template name"
          value={templateName ?? ''}
          onChangeText={setTemplateName}
          maxLength={60}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={saveAsTemplate}
        />
        {asTemplate.error ? (
          <Text color="danger">Couldn’t save: {describeError(asTemplate.error).message}</Text>
        ) : null}
        <Button
          title="Save template"
          onPress={saveAsTemplate}
          loading={asTemplate.isPending}
          disabled={!templateName?.trim()}
        />
      </BottomSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  setLine: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  setNo: { width: 20 },
});
