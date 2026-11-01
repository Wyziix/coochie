import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deleteProgram,
  fetchPrograms,
  generatePlan,
  savePlan,
  type PlanRequest,
} from '@/lib/api/ai';
import { planToDraft, planToSave, type PlanDraft } from '@/lib/plans/draft';
import { useUserId } from '@/stores/authStore';
import { usePlanDraftStore } from '@/stores/planDraftStore';

import { useExercises } from './useExercises';

// Same key as useTemplates (not imported: useTemplates imports this file).
const templatesKey = ['templates'] as const;

/** The user's saved programs (kept offline, so they show without a connection). */
export function usePrograms() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['programs', userId],
    queryFn: fetchPrograms,
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}

/** Asks Claude for a plan and opens it in the preview (counts toward the plan limit). */
export function useGeneratePlan() {
  const queryClient = useQueryClient();
  const exercises = useExercises().data;
  return useMutation({
    mutationFn: (request: PlanRequest) => generatePlan(request).then((r) => ({ ...r, request })),
    onSuccess: ({ plan, request }) => {
      const map = new Map((exercises ?? []).map((e) => [e.id, e]));
      usePlanDraftStore.getState().load(planToDraft(plan, request, map));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ai-status'] }),
  });
}

/** Saves the plan as a program of templates (needs a connection). */
export function useSavePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: PlanDraft) => {
      const { program, days } = planToSave(draft);
      return savePlan(program, days);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templatesKey });
      queryClient.invalidateQueries({ queryKey: ['programs'] });
    },
  });
}

/** Deletes a program and all its templates (needs a connection). */
export function useDeleteProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProgram,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templatesKey });
      queryClient.invalidateQueries({ queryKey: ['programs'] });
    },
  });
}
