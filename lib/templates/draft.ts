import type { Exercise } from '@/lib/api/exercises';
import type { Template, TemplatePayload } from '@/lib/api/templates';
import type { ExerciseType } from '@/lib/exercises/labels';
import { newId } from '@/lib/id';
import { formatDuration, parseDuration, parseNumber } from '@/lib/workout/format';

export type DraftExercise = {
  key: string;
  exerciseId: string;
  name: string;
  type: ExerciseType;
  sets: number;
  repsMin: string;
  repsMax: string;
  duration: string;
  restSeconds: number | null;
};

export type TemplateDraft = {
  id: string | null;
  name: string;
  notes: string;
  program: string;
  position: number;
  exercises: DraftExercise[];
};

export const MAX_SETS = 20;
export const MAX_EXERCISES = 30;

const usesReps = (type: ExerciseType) => type === 'weights' || type === 'bodyweight';

export function newDraftExercise(e: Pick<Exercise, 'id' | 'name' | 'type'>): DraftExercise {
  return {
    key: newId(),
    exerciseId: e.id,
    name: e.name,
    type: e.type,
    sets: e.type === 'cardio' ? 1 : 3,
    repsMin: usesReps(e.type) ? '8' : '',
    repsMax: usesReps(e.type) ? '12' : '',
    duration: e.type === 'timed' ? '0:45' : '',
    restSeconds: null,
  };
}

export const emptyDraft = (): TemplateDraft => ({
  id: null,
  name: '',
  notes: '',
  program: '',
  position: 0,
  exercises: [],
});

/** Draft from a saved template. `copy` makes a new template (e.g. from a ready-made one). */
export function draftFromTemplate(t: Template, { copy = false } = {}): TemplateDraft {
  return {
    id: copy ? null : t.id,
    name: copy ? `${t.name} (copy)`.slice(0, 60) : t.name,
    notes: t.notes ?? '',
    program: copy ? '' : (t.program ?? ''),
    position: t.position,
    exercises: t.exercises.map((te) => ({
      key: newId(),
      exerciseId: te.exercise_id,
      name: te.exercise.name,
      type: te.exercise.type,
      sets: te.target_sets,
      repsMin: te.target_reps_min != null ? String(te.target_reps_min) : '',
      repsMax: te.target_reps_max != null ? String(te.target_reps_max) : '',
      duration:
        te.target_duration_seconds != null ? formatDuration(te.target_duration_seconds) : '',
      restSeconds: te.rest_seconds,
    })),
  };
}

export type DraftErrors = { name?: string; exercises?: string } & Record<
  string,
  string | undefined
>;

export function validateTemplateDraft(d: TemplateDraft): DraftErrors {
  const errors: DraftErrors = {};
  const name = d.name.trim();
  if (!name) errors.name = 'Give it a name';
  else if (name.length > 60) errors.name = 'At most 60 characters';
  if (d.exercises.length === 0) errors.exercises = 'Add at least one exercise';
  if (d.exercises.length > MAX_EXERCISES) errors.exercises = `At most ${MAX_EXERCISES} exercises`;

  for (const e of d.exercises) {
    const min = parseNumber(e.repsMin);
    const max = parseNumber(e.repsMax);
    const bad = (n: number | null) => n !== null && (!Number.isInteger(n) || n < 1 || n > 100);
    if (bad(min) || bad(max)) errors[e.key] = 'Reps must be 1–100';
    else if (min !== null && max !== null && max < min) errors[e.key] = 'Max reps is below min';
    else if (e.duration && parseDuration(e.duration, 'seconds') === null)
      errors[e.key] = 'Time like 0:45';
  }
  return errors;
}

/** RPC arguments for save_template / admin_save_template. */
export function draftToPayload(d: TemplateDraft): TemplatePayload {
  return {
    p_template: {
      name: d.name.trim(),
      notes: d.notes.trim() || null,
      program: d.program.trim() || null,
      position: d.position,
    },
    p_exercises: d.exercises.map((e) => {
      const min = parseNumber(e.repsMin);
      const max = parseNumber(e.repsMax);
      return {
        exercise_id: e.exerciseId,
        target_sets: Math.min(MAX_SETS, Math.max(1, e.sets)),
        target_reps_min: min ?? max,
        target_reps_max: min !== null && max !== null && max > min ? max : null,
        target_duration_seconds: e.duration ? parseDuration(e.duration, 'seconds') : null,
        rest_seconds: e.restSeconds,
      };
    }),
  };
}
