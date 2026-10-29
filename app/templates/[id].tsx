import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, ErrorState, LoadingState, Text } from '@/components/ui';
import { useRestSettings } from '@/hooks/useExercises';
import { useProfile } from '@/hooks/useProfile';
import { useDeleteTemplate, useTemplate } from '@/hooks/useTemplates';
import { useTheme } from '@/hooks/useTheme';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { draftFromTemplate } from '@/lib/templates/draft';
import { formatTarget } from '@/lib/workout/format';
import { startTemplateWorkout } from '@/lib/workout/start';
import { useUserId } from '@/stores/authStore';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';

export default function TemplateDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: template, isPending, error, refetch } = useTemplate(id);
  const userId = useUserId();
  const units = useProfile().data?.units ?? 'kg';
  const { data: restSettings } = useRestSettings();
  const remove = useDeleteTemplate();

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!template)
    return <ErrorState title="Template not found" message="It may have been deleted." />;

  const own = template.owner_id === userId;

  function editCopy(copy: boolean) {
    useTemplateDraftStore.getState().load(draftFromTemplate(template!, { copy }));
    router.push('/templates/edit');
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Delete “${template!.name}”?`,
      message: 'Past workouts started from it are kept.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(template!.id, { onSuccess: () => router.back() });
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Stack.Screen options={{ title: template.name }} />
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="caption" color="textMuted">
          {own ? 'My template' : (template.program ?? 'Ready-made')}
        </Text>
        <Text variant="title">{template.name}</Text>
        {template.notes ? <Text color="textMuted">{template.notes}</Text> : null}
      </View>

      <Button
        title="Start workout"
        onPress={() => startTemplateWorkout(template, units, restSettings)}
        fullWidth
      />

      <Card>
        {template.exercises.map((te, i) => (
          <View key={te.id} style={[styles.line, { gap: theme.spacing.md }]}>
            <Text color="textMuted" style={styles.no}>
              {i + 1}
            </Text>
            <Text style={styles.flex}>{te.exercise.name}</Text>
            <Text variant="label" color="textMuted">
              {formatTarget({
                sets: te.target_sets,
                repsMin: te.target_reps_min,
                repsMax: te.target_reps_max,
                durationSeconds: te.target_duration_seconds,
              })}
            </Text>
          </View>
        ))}
      </Card>

      {own ? (
        <>
          <Button title="Edit template" variant="secondary" onPress={() => editCopy(false)} />
          <Button
            title="Delete template"
            variant="ghost"
            onPress={onDelete}
            loading={remove.isPending}
          />
          {remove.error ? (
            <Text color="danger">Couldn’t delete: {describeError(remove.error).message}</Text>
          ) : null}
        </>
      ) : (
        <Button title="Copy to my templates" variant="secondary" onPress={() => editCopy(true)} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  no: { width: 20 },
  flex: { flex: 1 },
});
