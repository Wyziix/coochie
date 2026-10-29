import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, IconButton, Input, Text } from '@/components/ui';
import { CellInput } from '@/components/workout/CellInput';
import { useTheme } from '@/hooks/useTheme';
import { describeError } from '@/lib/errors';
import {
  MAX_SETS,
  validateTemplateDraft,
  type DraftErrors,
  type DraftExercise,
  type TemplateDraft,
} from '@/lib/templates/draft';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';

type Props = {
  /** Admin editing a ready-made template: also edits program and order. */
  admin?: boolean;
  saving: boolean;
  onSave: (draft: TemplateDraft) => Promise<void>;
  /** Extra actions under the form (delete, hide...). */
  footer?: React.ReactNode;
};

const usesReps = (type: DraftExercise['type']) => type === 'weights' || type === 'bodyweight';

export function TemplateEditor({ admin, saving, onSave, footer }: Props) {
  const theme = useTheme();
  const draft = useTemplateDraftStore((s) => s.draft);
  const { update, updateExercise, removeExercise, moveExercise } = useTemplateDraftStore.getState();
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!draft) return null;

  async function save() {
    setSaveError(null);
    const found = validateTemplateDraft(draft!);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await onSave(draft!);
    } catch (e) {
      setSaveError(`Couldn’t save: ${describeError(e).message}`);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label="Name"
          value={draft.name}
          onChangeText={(name) => update({ name })}
          maxLength={60}
          placeholder="e.g. Push day"
          error={errors.name}
        />
        {admin ? (
          <View style={[styles.row, { gap: theme.spacing.md }]}>
            <View style={styles.flex}>
              <Input
                label="Program"
                value={draft.program}
                onChangeText={(program) => update({ program })}
                maxLength={60}
                placeholder="e.g. Push Pull Legs"
              />
            </View>
            <View style={{ width: 96 }}>
              <Input
                label="Order"
                value={String(draft.position)}
                onChangeText={(t) => update({ position: Number(t.replace(/\D/g, '')) || 0 })}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={3}
              />
            </View>
          </View>
        ) : null}
        <Input
          label="Notes (optional)"
          value={draft.notes}
          onChangeText={(notes) => update({ notes })}
          maxLength={1000}
          multiline
        />

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Exercises</Text>
          {errors.exercises ? <Text color="danger">{errors.exercises}</Text> : null}
          {draft.exercises.length === 0 ? (
            <EmptyState icon="barbell-outline" title="No exercises yet" message="Add them below." />
          ) : (
            draft.exercises.map((e, i) => (
              <Card key={e.key} style={{ padding: theme.spacing.md }}>
                <View style={[styles.row, { gap: theme.spacing.xs }]}>
                  <Text variant="label" style={styles.flex} numberOfLines={2}>
                    {i + 1}. {e.name}
                  </Text>
                  <IconButton
                    icon="arrow-up"
                    accessibilityLabel={`Move ${e.name} up`}
                    onPress={() => moveExercise(e.key, -1)}
                    disabled={i === 0}
                  />
                  <IconButton
                    icon="arrow-down"
                    accessibilityLabel={`Move ${e.name} down`}
                    onPress={() => moveExercise(e.key, 1)}
                    disabled={i === draft.exercises.length - 1}
                  />
                  <IconButton
                    icon="trash-outline"
                    color="danger"
                    accessibilityLabel={`Remove ${e.name}`}
                    onPress={() => removeExercise(e.key)}
                  />
                </View>
                <View style={[styles.row, { gap: theme.spacing.sm }]}>
                  <IconButton
                    icon="remove"
                    accessibilityLabel={`Fewer sets of ${e.name}`}
                    onPress={() => updateExercise(e.key, { sets: Math.max(1, e.sets - 1) })}
                    disabled={e.sets <= 1}
                  />
                  <Text variant="label" style={styles.sets} accessibilityLabel={`${e.sets} sets`}>
                    {e.sets} {e.sets === 1 ? 'set' : 'sets'}
                  </Text>
                  <IconButton
                    icon="add"
                    accessibilityLabel={`More sets of ${e.name}`}
                    onPress={() => updateExercise(e.key, { sets: Math.min(MAX_SETS, e.sets + 1) })}
                    disabled={e.sets >= MAX_SETS}
                  />
                  {usesReps(e.type) ? (
                    <>
                      <CellInput
                        accessibilityLabel={`${e.name} reps from`}
                        value={e.repsMin}
                        onChangeText={(t) =>
                          updateExercise(e.key, { repsMin: t.replace(/\D/g, '') })
                        }
                        placeholder="8"
                        keyboardType="number-pad"
                        inputMode="numeric"
                        maxLength={3}
                      />
                      <Text color="textMuted">–</Text>
                      <CellInput
                        accessibilityLabel={`${e.name} reps to`}
                        value={e.repsMax}
                        onChangeText={(t) =>
                          updateExercise(e.key, { repsMax: t.replace(/\D/g, '') })
                        }
                        placeholder="12"
                        keyboardType="number-pad"
                        inputMode="numeric"
                        maxLength={3}
                      />
                      <Text variant="caption" color="textMuted">
                        reps
                      </Text>
                    </>
                  ) : e.type === 'timed' ? (
                    <CellInput
                      accessibilityLabel={`${e.name} time`}
                      value={e.duration}
                      onChangeText={(t) =>
                        updateExercise(e.key, { duration: t.replace(/[^0-9:]/g, '') })
                      }
                      placeholder="0:45"
                      keyboardType="numbers-and-punctuation"
                      maxLength={6}
                    />
                  ) : null}
                </View>
                {errors[e.key] ? (
                  <Text variant="caption" color="danger">
                    {errors[e.key]}
                  </Text>
                ) : null}
              </Card>
            ))
          )}
          <Button
            title="Add exercises"
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/exercises/pick', params: { target: 'template' } })
            }
            fullWidth
          />
        </View>

        {saveError ? <Text color="danger">{saveError}</Text> : null}
        <Button title="Save template" onPress={save} loading={saving} fullWidth />
        {footer}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  sets: { minWidth: 56, textAlign: 'center' },
});
