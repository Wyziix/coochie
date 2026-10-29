import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ExerciseForm } from '@/components/exercises/ExerciseForm';
import { Button, Card, Text } from '@/components/ui';
import { useAdminSaveExercise, useAdminSetExerciseHidden, useExercise } from '@/hooks/useExercises';
import { useTheme } from '@/hooks/useTheme';
import { DuplicateExerciseError } from '@/lib/api/exercises';
import { confirm } from '@/lib/confirm';

/** Create (no id) or edit a global exercise. */
export default function AdminExerciseScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: existing } = useExercise(id);
  const save = useAdminSaveExercise();
  const setHidden = useAdminSetExerciseHidden();
  const [error, setError] = useState<string | null>(null);

  if (id && !existing) return null;

  async function toggleHidden() {
    if (!existing) return;
    const hide = !existing.is_hidden;
    const ok = await confirm({
      title: hide ? `Hide ${existing.name}?` : `Show ${existing.name}?`,
      message: hide
        ? 'It disappears from the library for everyone. Past workouts keep it.'
        : 'It shows up in the library again.',
      confirmLabel: hide ? 'Hide' : 'Show',
      destructive: hide,
    });
    if (!ok) return;
    setHidden.mutate(
      { id: existing.id, hidden: hide },
      { onError: () => setError('Couldn’t update. Try again.') },
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: existing ? 'Edit exercise' : 'New global exercise' }} />
      {existing ? (
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color={existing.is_hidden ? 'warning' : 'success'}>
              {existing.is_hidden ? 'Hidden from the library' : 'Visible in the library'}
            </Text>
            <Button
              title={existing.is_hidden ? 'Show in library' : 'Hide from library'}
              variant={existing.is_hidden ? 'secondary' : 'danger'}
              onPress={toggleHidden}
              loading={setHidden.isPending}
            />
          </View>
        </Card>
      ) : null}
      <ExerciseForm
        key={existing?.updated_at ?? 'new'}
        initial={existing}
        submitLabel={existing ? 'Save changes' : 'Create exercise'}
        saving={save.isPending}
        error={error}
        onSubmit={async (input) => {
          setError(null);
          try {
            await save.mutateAsync({ id: existing?.id ?? null, input });
            router.back();
          } catch (e) {
            setError(
              e instanceof DuplicateExerciseError
                ? e.message
                : 'Couldn’t save. Only admins can change global exercises.',
            );
          }
        }}
      />
    </ScrollView>
  );
}
