import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExerciseBrowser } from '@/components/exercises/ExerciseBrowser';
import { ExerciseRow } from '@/components/exercises/ExerciseRow';
import { Button } from '@/components/ui';
import { useExercises, useRecentExerciseIds, useRestSettings } from '@/hooks/useExercises';
import { useTheme } from '@/hooks/useTheme';
import { useTemplateDraftStore } from '@/stores/templateDraftStore';
import { useEditWorkoutStore, useWorkoutStore } from '@/stores/workoutStore';

/**
 * Pick one or more exercises (tap to select, then Add). ?target= decides
 * where they go: the active workout (default), a past workout being edited,
 * or the template being built.
 */
export default function PickExercisesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: exercises } = useExercises();
  const { data: restSettings } = useRestSettings();
  const { data: recentIds } = useRecentExerciseIds();
  const { target = 'workout' } = useLocalSearchParams<{
    target?: 'workout' | 'edit' | 'template';
  }>();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  function add() {
    const chosen = selected
      .map((id) => exercises?.find((e) => e.id === id))
      .filter((e) => e !== undefined);
    if (target === 'template') {
      useTemplateDraftStore.getState().addExercises(chosen);
    } else {
      const store = target === 'edit' ? useEditWorkoutStore : useWorkoutStore;
      store.getState().addExercises(chosen, (e) => restSettings?.[e.id] ?? e.default_rest_seconds);
    }
    router.back();
  }

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: theme.colors.background, paddingTop: theme.spacing.md },
      ]}
    >
      <Stack.Screen
        options={{
          title: 'Add exercises',
          headerRight: () => (
            <Button title="New" variant="ghost" onPress={() => router.push('/exercises/new')} />
          ),
        }}
      />
      <ExerciseBrowser
        recentIds={recentIds}
        renderItem={(e) => (
          <ExerciseRow
            exercise={e}
            selected={selected.includes(e.id)}
            onPress={() => toggle(e.id)}
            onInfo={() => router.push({ pathname: '/exercises/[id]', params: { id: e.id } })}
          />
        )}
      />
      {/* Always visible so the screen doesn't jump when the first row is tapped. */}
      <View
        style={{
          padding: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.lg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}
      >
        <Button
          title={`Add (${selected.length})`}
          accessibilityLabel={`Add ${selected.length} exercise${selected.length === 1 ? '' : 's'}`}
          onPress={add}
          disabled={selected.length === 0}
          fullWidth
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
