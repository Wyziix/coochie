import type { Exercise } from '@/lib/api/exercises';
import type { GeneratedPlan, PlanRequest } from '@/lib/api/ai';
import { newId } from '@/lib/id';
import { draftToPayload, type TemplateDraft } from '@/lib/templates/draft';

/** A generated plan as the preview edits it: each day is a template draft. */
export type PlanDraft = {
  request: PlanRequest;
  name: string;
  description: string;
  weeks: number;
  progression: string;
  notes: string[];
  days: (TemplateDraft & { focus: string })[];
};

export function planToDraft(
  plan: GeneratedPlan,
  request: PlanRequest,
  exercises: Map<string, Pick<Exercise, 'name' | 'type'>>,
): PlanDraft {
  return {
    request,
    name: plan.name,
    description: plan.description,
    weeks: plan.weeks,
    progression: plan.progression,
    notes: plan.notes,
    days: plan.days.map((day, i) => ({
      id: null,
      name: day.name,
      focus: day.focus,
      notes: day.focus,
      program: '',
      position: i,
      exercises: day.exercises.map((e) => {
        const known = exercises.get(e.exercise_id);
        return {
          key: newId(),
          exerciseId: e.exercise_id,
          name: e.name || known?.name || 'Exercise',
          type: known?.type ?? 'weights',
          sets: e.sets,
          repsMin: String(e.reps_min),
          repsMax: String(e.reps_max),
          duration: '',
          restSeconds: e.rest_seconds,
        };
      }),
    })),
  };
}

/** Arguments for save_ai_plan(). Programs are named up to 60 characters. */
export function planToSave(draft: PlanDraft) {
  return {
    program: {
      name: draft.name.trim().slice(0, 60) || 'My plan',
      description: [draft.description, draft.progression].filter(Boolean).join(' ').slice(0, 600),
      weeks: Math.min(16, Math.max(1, draft.weeks)),
      notes: draft.notes,
    },
    days: draft.days.map((d) => {
      const payload = draftToPayload(d);
      return { p_template: payload.p_template, p_exercises: payload.p_exercises };
    }),
  };
}

/** "3 × 6–8", "4 × 5". */
export function setsReps(sets: number, min: string, max: string) {
  const reps = min && max && min !== max ? `${min}–${max}` : min || max;
  return reps ? `${sets} × ${reps}` : `${sets} sets`;
}

/** "rest 1:30". */
export function restLabel(seconds: number | null) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `rest ${m}:${String(s).padStart(2, '0')}`;
}
