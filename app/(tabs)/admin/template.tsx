import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { TemplateEditor } from '@/components/templates/TemplateEditor';
import { Button, Card, Text } from '@/components/ui';
import {
  useAdminDeleteTemplate,
  useAdminSaveTemplate,
  useAdminSetTemplateHidden,
  useTemplate,
} from '@/hooks/useTemplates';
import { useTheme } from '@/hooks/useTheme';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { draftToPayload } from '@/lib/templates/draft';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';

/** Create (no id) or edit a ready-made template. Server checks the role and logs every change. */
export default function AdminTemplateScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const draft = useTemplateDraftStore((s) => s.draft);
  const { data: existing } = useTemplate(id);
  const save = useAdminSaveTemplate();
  const setHidden = useAdminSetTemplateHidden();
  const remove = useAdminDeleteTemplate();

  if (!draft) return <Redirect href="/admin/templates" />;

  async function toggleHidden() {
    if (!existing) return;
    const hide = !existing.is_hidden;
    const ok = await confirm({
      title: hide ? `Hide “${existing.name}”?` : `Show “${existing.name}”?`,
      message: hide
        ? 'Users stop seeing it. Workouts already done keep it.'
        : 'Users see it again.',
      confirmLabel: hide ? 'Hide' : 'Show',
      destructive: hide,
    });
    if (ok) setHidden.mutate({ id: existing.id, hidden: hide });
  }

  async function onDelete() {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete “${existing.name}”?`,
      message:
        'Removed for everyone. Past workouts keep their sets. Hiding is reversible; this isn’t.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(existing.id, {
      onSuccess: () => {
        useTemplateDraftStore.getState().clear();
        router.back();
      },
    });
  }

  const actionError = setHidden.error ?? remove.error;

  return (
    <>
      <Stack.Screen
        options={{ title: draft.id ? 'Edit ready-made template' : 'New ready-made template' }}
      />
      <TemplateEditor
        admin
        saving={save.isPending}
        onSave={async (d) => {
          await save.mutateAsync({ id: d.id, payload: draftToPayload(d) });
          useTemplateDraftStore.getState().clear();
          router.back();
        }}
        footer={
          existing ? (
            <Card>
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color={existing.is_hidden ? 'warning' : 'success'}>
                  {existing.is_hidden ? 'Hidden from users' : 'Visible to users'}
                </Text>
                <Button
                  title={existing.is_hidden ? 'Show to users' : 'Hide from users'}
                  variant="secondary"
                  onPress={toggleHidden}
                  loading={setHidden.isPending}
                />
                <Button
                  title="Delete template"
                  variant="danger"
                  onPress={onDelete}
                  loading={remove.isPending}
                />
                {actionError ? (
                  <Text color="danger">Couldn’t update: {describeError(actionError).message}</Text>
                ) : null}
              </View>
            </Card>
          ) : null
        }
      />
    </>
  );
}
