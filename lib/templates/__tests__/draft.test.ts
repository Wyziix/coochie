import {
  draftFromTemplate,
  draftToPayload,
  emptyDraft,
  newDraftExercise,
  validateTemplateDraft,
} from '@/lib/templates/draft';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';
import { template } from '@/test-utils/fixtures';

describe('template drafts', () => {
  it('round-trips a template to the save payload', () => {
    const d = draftFromTemplate(template);
    expect(d).toMatchObject({ id: 't1', name: 'Push', program: 'Push Pull Legs' });
    expect(draftToPayload(d)).toEqual({
      p_template: { name: 'Push', notes: 'Chest day', program: 'Push Pull Legs', position: 1 },
      p_exercises: [
        {
          exercise_id: 'bench',
          target_sets: 4,
          target_reps_min: 6,
          target_reps_max: 8,
          target_duration_seconds: null,
          rest_seconds: 180,
        },
        {
          exercise_id: 'plank',
          target_sets: 2,
          target_reps_min: null,
          target_reps_max: null,
          target_duration_seconds: 45,
          rest_seconds: null,
        },
      ],
    });
  });

  it('copies a ready-made template as a new one of your own', () => {
    const d = draftFromTemplate(template, { copy: true });
    expect(d).toMatchObject({ id: null, name: 'Push (copy)', program: '' });
  });

  it('a fixed rep count is saved as min only', () => {
    const d = {
      ...emptyDraft(),
      name: 'x',
      exercises: [
        {
          ...newDraftExercise({ id: 'e', name: 'E', type: 'weights' }),
          repsMin: '5',
          repsMax: '5',
        },
      ],
    };
    expect(
      (draftToPayload(d).p_exercises as { target_reps_max: unknown }[])[0]!.target_reps_max,
    ).toBeNull();
  });

  it('validates name, exercises and rep ranges', () => {
    expect(Object.keys(validateTemplateDraft(emptyDraft())).sort()).toEqual(['exercises', 'name']);
    const ex = {
      ...newDraftExercise({ id: 'e', name: 'E', type: 'weights' }),
      repsMin: '12',
      repsMax: '8',
    };
    const errors = validateTemplateDraft({ ...emptyDraft(), name: 'A', exercises: [ex] });
    expect(errors[ex.key]).toBe('Max reps is below min');
  });

  it('new exercises get sensible defaults by type', () => {
    expect(newDraftExercise({ id: 'a', name: 'A', type: 'weights' })).toMatchObject({
      sets: 3,
      repsMin: '8',
      repsMax: '12',
    });
    expect(newDraftExercise({ id: 'b', name: 'B', type: 'timed' })).toMatchObject({
      duration: '0:45',
      repsMin: '',
    });
  });
});

describe('template draft store', () => {
  it('adds, reorders and removes exercises', () => {
    const s = useTemplateDraftStore.getState();
    s.load(emptyDraft());
    s.addExercises([
      { id: 'a', name: 'A', type: 'weights' },
      { id: 'b', name: 'B', type: 'weights' },
    ]);
    const [a, b] = useTemplateDraftStore.getState().draft!.exercises;
    s.moveExercise(b!.key, -1);
    expect(useTemplateDraftStore.getState().draft!.exercises.map((e) => e.name)).toEqual([
      'B',
      'A',
    ]);
    s.moveExercise(b!.key, -1); // already first: no-op
    s.removeExercise(a!.key);
    expect(useTemplateDraftStore.getState().draft!.exercises.map((e) => e.name)).toEqual(['B']);
  });
});
