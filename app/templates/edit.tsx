import { Redirect, router, Stack } from 'expo-router';

import { TemplateEditor } from '@/components/templates/TemplateEditor';
import { useSaveTemplate } from '@/hooks/useTemplates';
import { draftToPayload } from '@/lib/templates/draft';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';

/** Create (draft without id) or edit one of the user's templates. The draft is loaded before navigating here. */
export default function EditTemplateScreen() {
  const draft = useTemplateDraftStore((s) => s.draft);
  const save = useSaveTemplate();

  // Opened directly (e.g. page reload on web): nothing to edit.
  if (!draft) return <Redirect href="/workout" />;

  return (
    <>
      <Stack.Screen options={{ title: draft.id ? 'Edit template' : 'New template' }} />
      <TemplateEditor
        saving={save.isPending}
        onSave={async (d) => {
          const saved = await save.mutateAsync({ id: d.id, payload: draftToPayload(d) });
          useTemplateDraftStore.getState().clear();
          router.replace({ pathname: '/templates/[id]', params: { id: saved.id } });
        }}
      />
    </>
  );
}
