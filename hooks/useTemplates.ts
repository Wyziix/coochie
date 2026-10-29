import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  adminDeleteTemplate,
  adminSaveTemplate,
  adminSetTemplateHidden,
  fetchTemplates,
  type TemplatePayload,
} from '@/lib/api/templates';
import type { WorkoutDetail } from '@/lib/api/workouts';
import { newId } from '@/lib/id';
import { enqueue, useOutboxStore } from '@/lib/offline/outbox';
import { overlayTemplates } from '@/lib/offline/overlay';
import { syncNow } from '@/lib/offline/sync';
import { templatePayloadFromWorkout } from '@/lib/templates/fromWorkout';
import { useUserId } from '@/stores/authStore';

import { useExercises } from './useExercises';

export const templatesKey = ['templates'] as const;

/** Ready-made and own templates, incl. changes made offline and not synced yet. */
export function useTemplates() {
  const query = useQuery({
    queryKey: templatesKey,
    queryFn: fetchTemplates,
    staleTime: 5 * 60_000,
  });
  const items = useOutboxStore((s) => s.items);
  const exercises = useExercises().data;
  const data = useMemo(() => {
    if (!query.data && !items.some((i) => i.kind === 'save_template')) return query.data;
    return overlayTemplates(query.data, items, new Map((exercises ?? []).map((e) => [e.id, e])));
  }, [query.data, items, exercises]);
  return { ...query, data };
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

/** Queued, so it works offline. New templates get their id here. */
export function useSaveTemplate() {
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string | null; payload: TemplatePayload }) => {
      const templateId = id ?? newId();
      const name = (payload.p_template as { name?: string }).name ?? 'Template';
      await enqueue({
        kind: 'save_template',
        entityId: templateId,
        payload,
        label: `Template “${name}”`,
      });
      syncNow();
      return { id: templateId };
    },
  });
}

export function useDeleteTemplate() {
  return useMutation({
    mutationFn: async (template: { id: string; name: string }) => {
      await enqueue({
        kind: 'delete_template',
        entityId: template.id,
        payload: null,
        label: `Delete template “${template.name}”`,
      });
      syncNow();
    },
  });
}

/** Built on the device and queued, so it works offline (and before the workout synced). */
export function useTemplateFromWorkout() {
  const save = useSaveTemplate();
  return useMutation({
    mutationFn: ({ workout, name }: { workout: WorkoutDetail; name: string }) =>
      save.mutateAsync({ id: null, payload: templatePayloadFromWorkout(workout, name) }),
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
