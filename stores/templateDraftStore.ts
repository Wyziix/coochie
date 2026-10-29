import { create } from 'zustand';

import type { Exercise } from '@/lib/api/exercises';
import { newDraftExercise, type DraftExercise, type TemplateDraft } from '@/lib/templates/draft';

type TemplateDraftState = {
  draft: TemplateDraft | null;
  load: (draft: TemplateDraft) => void;
  update: (patch: Partial<Omit<TemplateDraft, 'exercises'>>) => void;
  addExercises: (exercises: Pick<Exercise, 'id' | 'name' | 'type'>[]) => void;
  updateExercise: (key: string, patch: Partial<DraftExercise>) => void;
  removeExercise: (key: string) => void;
  moveExercise: (key: string, delta: -1 | 1) => void;
  clear: () => void;
};

/** The template being created or edited (shared with the exercise picker). */
export const useTemplateDraftStore = create<TemplateDraftState>()((set) => ({
  draft: null,
  load: (draft) => set({ draft }),
  update: (patch) => set((s) => ({ draft: s.draft && { ...s.draft, ...patch } })),
  addExercises: (exercises) =>
    set((s) => ({
      draft: s.draft && {
        ...s.draft,
        exercises: [...s.draft.exercises, ...exercises.map(newDraftExercise)],
      },
    })),
  updateExercise: (key, patch) =>
    set((s) => ({
      draft: s.draft && {
        ...s.draft,
        exercises: s.draft.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)),
      },
    })),
  removeExercise: (key) =>
    set((s) => ({
      draft: s.draft && { ...s.draft, exercises: s.draft.exercises.filter((e) => e.key !== key) },
    })),
  moveExercise: (key, delta) =>
    set((s) => {
      if (!s.draft) return s;
      const list = [...s.draft.exercises];
      const i = list.findIndex((e) => e.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return s;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { draft: { ...s.draft, exercises: list } };
    }),
  clear: () => set({ draft: null }),
}));
