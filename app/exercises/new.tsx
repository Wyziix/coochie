import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { ExerciseForm } from '@/components/exercises/ExerciseForm';
import { useExercise, useSaveCustomExercise } from '@/hooks/useExercises';
import { useTheme } from '@/hooks/useTheme';
import { DuplicateExerciseError } from '@/lib/api/exercises';

/** Create a custom exercise, or edit one of yours with ?id=. */
export default function CustomExerciseScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: existing } = useExercise(id);
  const save = useSaveCustomExercise();
  const [error, setError] = useState<string | null>(null);
  const editing = !!id;

  if (editing && !existing) return null;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: editing ? 'Edit exercise' : 'New exercise' }} />
      <ExerciseForm
        initial={existing}
        submitLabel={editing ? 'Save' : 'Create exercise'}
        saving={save.isPending}
        error={error}
        onSubmit={async (input) => {
          setError(null);
          try {
            await save.mutateAsync({ id, input });
            router.back();
          } catch (e) {
            setError(e instanceof DuplicateExerciseError ? e.message : 'Couldn’t save. Try again.');
          }
        }}
      />
    </ScrollView>
  );
}
