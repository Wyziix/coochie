import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminDeleteTemplate,
  adminSaveTemplate,
  adminSetTemplateHidden,
  deleteTemplate,
  fetchTemplates,
  saveTemplate,
  templateFromWorkout,
  type TemplatePayload,
} from '@/lib/api/templates';
import { useUserId } from '@/stores/authStore';

export const templatesKey = ['templates'] as const;

export function useTemplates() {
  return useQuery({ queryKey: templatesKey, queryFn: fetchTemplates, staleTime: 5 * 60_000 });
}

/** Templates split into the user's own and ready-made programs (grouped, in order). */
export function useTemplateGroups() {
  const userId = useUserId();
  const query = useTemplates();
  const all = query.data ?? [];
  const mine = all
    .filter((t) => t.owner_id === userId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const programs: { program: string; templates: typeof all }[] = [];
  for (const t of all.filter((t) => t.owner_id === null)) {
    const name = t.program ?? 'Other';
    let group = programs.find((p) => p.program === name);
    if (!group) programs.push((group = { program: name, templates: [] }));
    group.templates.push(t);
  }
  return { ...query, mine, programs };
}

export function useTemplate(id: string | undefined) {
  const query = useTemplates();
  return { ...query, data: query.data?.find((t) => t.id === id) };
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: templatesKey });
}

export function useSaveTemplate() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string | null; payload: TemplatePayload }) =>
      saveTemplate(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteTemplate() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: deleteTemplate, onSuccess: invalidate });
}

export function useTemplateFromWorkout() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ workoutId, name }: { workoutId: string; name: string }) =>
      templateFromWorkout(workoutId, name),
    onSuccess: invalidate,
  });
}

export function useAdminSaveTemplate() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string | null; payload: TemplatePayload }) =>
      adminSaveTemplate(id, payload),
    onSuccess: invalidate,
  });
}

export function useAdminSetTemplateHidden() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      adminSetTemplateHidden(id, hidden),
    onSuccess: invalidate,
  });
}

export function useAdminDeleteTemplate() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: adminDeleteTemplate, onSuccess: invalidate });
}
