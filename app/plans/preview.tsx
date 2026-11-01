import { Redirect, router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { FeatureLimit, useFeatureLimit } from '@/components/ai/FeatureLimit';
import { ThinkingIndicator } from '@/components/ai/ThinkingIndicator';
import { Button, Card, Text } from '@/components/ui';
import { useGeneratePlan, useSavePlan } from '@/hooks/usePlans';
import { useTheme } from '@/hooks/useTheme';
import { AiError } from '@/lib/api/ai';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { restLabel, setsReps } from '@/lib/plans/draft';
import { usePlanDraftStore } from '@/stores/planDraftStore';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';

const message = (e: unknown) =>
  e instanceof AiError ? e.message : e ? describeError(e).message : null;

/** The generated plan: accept (saves it as a program), regenerate, or edit a day first. */
export default function PlanPreviewScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const draft = usePlanDraftStore((s) => s.draft);
  const save = useSavePlan();
  const regenerate = useGeneratePlan();
  const limit = useFeatureLimit('plan');

  // Opened directly (e.g. page reload on web): nothing to show.
  if (!draft) return <Redirect href="/plans/new" />;

  function editDay(index: number) {
    usePlanDraftStore.getState().startEditing(index);
    useTemplateDraftStore.getState().load({ ...draft!.days[index]! });
    router.push('/plans/edit-day');
  }

  async function again() {
    const ok = await confirm({
      title: 'Build a new plan?',
      message: 'This one is replaced, and it uses one of today’s plans.',
      confirmLabel: 'Regenerate',
    });
    if (ok) regenerate.mutate(draft!.request);
  }

  function accept() {
    save.mutate(draft!, {
      onSuccess: () => {
        usePlanDraftStore.getState().clear();
        router.dismissTo('/workout');
      },
    });
  }

  const busy = regenerate.isPending || save.isPending;
  const error = message(save.error) ?? message(regenerate.error);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      {regenerate.isPending ? (
        <ThinkingIndicator hint="Building a new plan…" />
      ) : (
        <>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="title">{draft.name}</Text>
            <Text color="textMuted">
              {draft.days.length} days a week · run it for {draft.weeks} weeks
            </Text>
            <Text>{draft.description}</Text>
          </View>
          <Card>
            <Text variant="label">How to progress</Text>
            <Text>{draft.progression}</Text>
            {draft.notes.map((n) => (
              <Text key={n} color="textMuted">
                • {n}
              </Text>
            ))}
          </Card>

          {draft.days.map((day, i) => (
            <Card key={`${i}-${day.name}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text variant="heading">{day.name}</Text>
                  {day.focus ? (
                    <Text variant="caption" color="textMuted">
                      {day.focus}
                    </Text>
                  ) : null}
                </View>
                <Button
                  title="Edit"
                  variant="ghost"
                  onPress={() => editDay(i)}
                  disabled={busy}
                  accessibilityLabel={`Edit ${day.name}`}
                />
              </View>
              {day.exercises.map((e) => (
                <View key={e.key} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <Text style={{ flex: 1 }}>{e.name}</Text>
                  <Text color="textMuted">
                    {setsReps(e.sets, e.repsMin, e.repsMax)}
                    {e.restSeconds ? ` · ${restLabel(e.restSeconds)}` : ''}
                  </Text>
                </View>
              ))}
            </Card>
          ))}
        </>
      )}

      <View style={{ gap: theme.spacing.sm }}>
        {error ? <Text color="danger">{error}</Text> : null}
        <Button
          title="Save plan"
          onPress={accept}
          loading={save.isPending}
          disabled={busy || !online}
          fullWidth
        />
        <Button
          title="Regenerate"
          variant="secondary"
          onPress={again}
          disabled={busy || !online || limit.blocked}
          fullWidth
        />
        <FeatureLimit feature="plan" />
        {!online ? (
          <Text variant="caption" color="textMuted">
            Saving or regenerating needs a connection.
          </Text>
        ) : null}
        <Text variant="caption" color="textMuted">
          Saving adds one template per day under My programs. You can delete the whole program
          later.
        </Text>
      </View>
    </ScrollView>
  );
}
