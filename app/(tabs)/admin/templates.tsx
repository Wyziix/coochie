import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { TemplateCard } from '@/components/templates/TemplateCard';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { useTemplateGroups } from '@/hooks/useTemplates';
import { useTheme } from '@/hooks/useTheme';
import { emptyDraft, draftFromTemplate } from '@/lib/templates/draft';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';

/** Ready-made templates (hidden ones included), grouped by program. */
export default function AdminTemplatesScreen() {
  const theme = useTheme();
  const { programs, isPending, error, refetch, data } = useTemplateGroups();

  const create = () => {
    useTemplateDraftStore.getState().load(emptyDraft());
    router.push('/admin/template');
  };

  return (
    <Screen scroll edges={[]}>
      <Stack.Screen
        options={{ headerRight: () => <Button title="Add" variant="ghost" onPress={create} /> }}
      />
      <View style={{ height: theme.spacing.md }} />
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : programs.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          title="No ready-made templates"
          actionLabel="Add one"
          onAction={create}
        />
      ) : (
        programs.map(({ program, templates }) => (
          <View key={program} style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="textMuted">
              {program}
            </Text>
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onOpen={() => {
                  const full = data?.find((x) => x.id === t.id) ?? t;
                  useTemplateDraftStore.getState().load(draftFromTemplate(full));
                  router.push({ pathname: '/admin/template', params: { id: t.id } });
                }}
              />
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
