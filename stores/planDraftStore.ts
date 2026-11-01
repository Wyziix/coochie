import { create } from 'zustand';

import type { PlanDraft } from '@/lib/plans/draft';
import type { TemplateDraft } from '@/lib/templates/draft';

type PlanDraftState = {
  draft: PlanDraft | null;
  /** The day open in the template editor. */
  editing: number | null;
  load: (draft: PlanDraft) => void;
  startEditing: (index: number) => void;
  saveDay: (day: TemplateDraft) => void;
  clear: () => void;
};

/** The generated plan in the preview, until it's saved or thrown away. */
export const usePlanDraftStore = create<PlanDraftState>()((set) => ({
  draft: null,
  editing: null,
  load: (draft) => set({ draft, editing: null }),
  startEditing: (index) => set({ editing: index }),
  saveDay: (day) =>
    set((s) => {
      if (!s.draft || s.editing === null) return s;
      const days = s.draft.days.map((d, i) =>
        i === s.editing ? { ...day, id: null, focus: d.focus, position: i } : d,
      );
      return { draft: { ...s.draft, days }, editing: null };
    }),
  clear: () => set({ draft: null, editing: null }),
}));
