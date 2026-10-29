import { router } from 'expo-router';
import { View } from 'react-native';

import { TemplateCard } from '@/components/templates/TemplateCard';
import { WorkoutRow } from '@/components/workouts/WorkoutRow';
import { Button, Card, EmptyState, ErrorState, Header, Screen, Text } from '@/components/ui';
import { useRestSettings } from '@/hooks/useExercises';
import { useNow } from '@/hooks/useNow';
import { useProfile } from '@/hooks/useProfile';
import { useTemplateGroups } from '@/hooks/useTemplates';
import { useTheme } from '@/hooks/useTheme';
import { useRecentWorkouts } from '@/hooks/useWorkouts';
import type { Template } from '@/lib/api/templates';
import { emptyDraft } from '@/lib/templates/draft';
import { formatDuration } from '@/lib/workout/format';
import { startEmptyWorkout, startTemplateWorkout } from '@/lib/workout/start';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';
import { useWorkoutStore } from '@/stores/workoutStore';

export default function WorkoutScreen() {
  const theme = useTheme();
  const { data: profile } = useProfile();
  const workout = useWorkoutStore((s) => s.workout);
  const now = useNow(1000, workout !== null);
  const recent = useRecentWorkouts(3);
  const templates = useTemplateGroups();
  const { data: restSettings } = useRestSettings();
  const units = profile?.units ?? 'kg';

  const start = (t: Template) => startTemplateWorkout(t, units, restSettings);
  const open = (t: Template) => router.push({ pathname: '/templates/[id]', params: { id: t.id } });
  const section = { gap: theme.spacing.sm } as const;

  return (
    <Screen scroll header={<Header title="Workout" />}>
      {workout ? (
        // Not pressable itself: a pressable card containing a Button nests <button>s on web.
        <Card>
          <Text variant="caption" color="primary">
            In progress · {formatDuration((now - Date.parse(workout.startedAt)) / 1000)}
          </Text>
          <Text variant="heading">{workout.name}</Text>
          <Text color="textMuted">
            {workout.exercises.length} exercise{workout.exercises.length === 1 ? '' : 's'}
          </Text>
          <Button title="Resume workout" onPress={() => router.push('/workouts/active')} />
        </Card>
      ) : null}

      <Button
        title="Start empty workout"
        variant={workout ? 'secondary' : 'primary'}
        onPress={() => startEmptyWorkout(units)}
        fullWidth
      />

      <View style={section}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text variant="heading" style={{ flex: 1 }}>
            My templates
          </Text>
          <Button
            title="+ New"
            variant="ghost"
            onPress={() => {
              useTemplateDraftStore.getState().load(emptyDraft());
              router.push('/templates/edit');
            }}
          />
        </View>
        {templates.error ? (
          <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
        ) : templates.mine.length ? (
          templates.mine.map((t) => (
            <TemplateCard key={t.id} template={t} onOpen={() => open(t)} onStart={() => start(t)} />
          ))
        ) : templates.isPending ? null : (
          <Text color="textMuted">
            Build your own, copy a ready-made one, or save a finished workout as a template.
          </Text>
        )}
      </View>

      {templates.programs.map(({ program, templates: list }) => (
        <View key={program} style={section}>
          <Text variant="label" color="textMuted">
            {program}
          </Text>
          {list.map((t) => (
            <TemplateCard key={t.id} template={t} onOpen={() => open(t)} onStart={() => start(t)} />
          ))}
        </View>
      ))}

      <View style={section}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text variant="heading" style={{ flex: 1 }}>
            Recent
          </Text>
          <Button title="History" variant="ghost" onPress={() => router.push('/history')} />
        </View>
        {recent.error ? (
          <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
        ) : recent.data?.length ? (
          recent.data.map((w) => <WorkoutRow key={w.id} workout={w} unit={units} />)
        ) : recent.isPending ? null : (
          <EmptyState
            icon="barbell-outline"
            title="No workouts yet"
            message="Start one above. It's saved when you finish."
          />
        )}
      </View>
    </Screen>
  );
}
