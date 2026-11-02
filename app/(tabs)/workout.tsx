import { router } from 'expo-router';
import { View } from 'react-native';

import { TemplateCard } from '@/components/templates/TemplateCard';
import { WorkoutRow } from '@/components/workouts/WorkoutRow';
import { Button, Card, EmptyState, ErrorState, Header, Screen, Text } from '@/components/ui';
import { useRestSettings } from '@/hooks/useExercises';
import { useNow } from '@/hooks/useNow';
import { useProfile } from '@/hooks/useProfile';
import { useDeleteProgram } from '@/hooks/usePlans';
import { useTemplateGroups } from '@/hooks/useTemplates';
import { useTheme } from '@/hooks/useTheme';
import { useRecentWorkouts } from '@/hooks/useWorkouts';
import type { Template } from '@/lib/api/templates';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
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
  const deleteProgram = useDeleteProgram();
  const online = useIsOnline();
  const { data: restSettings } = useRestSettings();
  const units = profile?.units ?? 'kg';

  const start = (t: Template) => startTemplateWorkout(t, units, restSettings);
  const open = (t: Template) => router.push({ pathname: '/templates/[id]', params: { id: t.id } });
  const section = { gap: theme.spacing.sm } as const;

  async function removeProgram(id: string, name: string, days: number) {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      message: `Its ${days} template${days === 1 ? '' : 's'} are deleted too. Past workouts stay in your history.`,
      confirmLabel: 'Delete program',
      destructive: true,
    });
    if (ok) deleteProgram.mutate(id);
  }

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

      <View style={section}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text variant="heading" style={{ flex: 1 }}>
            My programs
          </Text>
          <Button title="+ AI plan" variant="ghost" onPress={() => router.push('/plans/new')} />
        </View>
        {templates.myPrograms.length ? (
          templates.myPrograms.map(({ id, program, templates: list }) => (
            <View key={id} style={section}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="label">{program?.name ?? 'Program'}</Text>
                  <Text variant="caption" color="textMuted">
                    {list.length} day{list.length === 1 ? '' : 's'}
                    {program?.weeks ? ` · ${program.weeks} weeks` : ''}
                  </Text>
                </View>
                <Button
                  title="Delete program"
                  variant="ghost"
                  disabled={!online || deleteProgram.isPending}
                  onPress={() => removeProgram(id, program?.name ?? 'Program', list.length)}
                />
              </View>
              {list.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onOpen={() => open(t)}
                  onStart={() => start(t)}
                />
              ))}
            </View>
          ))
        ) : templates.isPending ? null : (
          <Text color="textMuted">
            Let Gleb build a multi-week plan from your goal, schedule and equipment.
          </Text>
        )}
        {deleteProgram.error ? (
          <Text color="danger">Couldn’t delete: {describeError(deleteProgram.error).message}</Text>
        ) : null}
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
