import { Redirect, router, Stack } from 'expo-router';

import { TemplateEditor } from '@/components/templates/TemplateEditor';
import { usePlanDraftStore } from '@/stores/planDraftStore';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';

/** Edit one day of the generated plan before saving it; goes back to the preview. */
export default function EditPlanDayScreen() {
  const draft = useTemplateDraftStore((s) => s.draft);
  const editing = usePlanDraftStore((s) => s.editing);

  if (!draft || editing === null) return <Redirect href="/plans/preview" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Edit day' }} />
      <TemplateEditor
        saving={false}
        saveLabel="Done"
        onSave={async (d) => {
          usePlanDraftStore.getState().saveDay(d);
          useTemplateDraftStore.getState().clear();
          router.back();
        }}
      />
    </>
  );
}
