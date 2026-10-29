import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button, EmptyState, Input, Text } from '@/components/ui';
import { ExerciseCard } from '@/components/workout/ExerciseCard';
import { useTheme } from '@/hooks/useTheme';
import { useSaveWorkout } from '@/hooks/useWorkouts';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { dateKey, parseWorkoutTimes } from '@/lib/history/calendar';
import { countSets, toSavePayload } from '@/lib/workout/payload';
import { useEditWorkoutStore, WorkoutStoreContext } from '@/stores/workoutStore';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Edit a past workout: name, date and time, duration, sets. Saved through
 * save_workout like a finished workout, so the server recomputes duration
 * and volume (and, from Stage 4/8, records and points).
 */
export default function EditWorkoutScreen() {
  const theme = useTheme();
  const workout = useEditWorkoutStore((s) => s.workout);
  const save = useSaveWorkout();
  const [initial] = useState(() => {
    const w = useEditWorkoutStore.getState().workout;
    const start = w ? new Date(w.startedAt) : new Date();
    return { date: dateKey(start), time: `${pad(start.getHours())}:${pad(start.getMinutes())}` };
  });
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const { minutes } = useLocalSearchParams<{ minutes?: string }>();
  const [duration, setDuration] = useState(minutes ?? '60');
  const [error, setError] = useState<string | null>(null);

  // Opened directly (e.g. page reload on web): nothing loaded to edit.
  if (!workout) return <Redirect href="/history" />;

  async function onSave() {
    setError(null);
    const current = useEditWorkoutStore.getState().workout!;
    const times = parseWorkoutTimes(date, time, duration);
    if ('error' in times) return setError(times.error);
    const { done, undone } = countSets(current);
    if (done === 0)
      return setError(
        'A workout needs at least one completed set. To remove it, delete it instead.',
      );
    if (undone > 0) {
      const ok = await confirm({
        title: 'Save changes?',
        message: `${undone} set${undone === 1 ? ' isn’t' : 's aren’t'} ticked and will be removed.`,
        confirmLabel: 'Save',
      });
      if (!ok) return;
    }
    try {
      await save.mutateAsync(
        toSavePayload({ ...current, startedAt: times.startedAt.toISOString() }, times.endedAt),
      );
      useEditWorkoutStore.getState().discard();
      router.back();
    } catch (e) {
      setError(`Couldn’t save: ${describeError(e).message}`);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: 'Edit workout' }} />
      <WorkoutStoreContext.Provider value={{ store: useEditWorkoutStore, mode: 'edit' }}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.md }}
          keyboardShouldPersistTaps="handled"
        >
          <Input
            label="Name"
            value={workout.name}
            onChangeText={(name) => useEditWorkoutStore.getState().rename(name)}
            maxLength={60}
          />
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <View style={styles.flex}>
              <Input
                label="Date"
                value={date}
                onChangeText={setDate}
                placeholder="2026-10-31"
                maxLength={10}
              />
            </View>
            <View style={styles.flex}>
              <Input
                label="Start"
                value={time}
                onChangeText={setTime}
                placeholder="18:30"
                maxLength={5}
              />
            </View>
            <View style={styles.flex}>
              <Input
                label="Minutes"
                value={duration}
                onChangeText={(t) => setDuration(t.replace(/\D/g, ''))}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={4}
              />
            </View>
          </View>

          {workout.exercises.length === 0 ? (
            <EmptyState icon="add-circle-outline" title="No exercises" />
          ) : (
            workout.exercises.map((exercise) => (
              <ExerciseCard key={exercise.key} exercise={exercise} unit={workout.units} />
            ))
          )}
          <Button
            title="Add exercises"
            variant="secondary"
            onPress={() => router.push({ pathname: '/exercises/pick', params: { target: 'edit' } })}
            fullWidth
          />
          {error ? (
            <Text color="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button title="Save changes" onPress={onSave} loading={save.isPending} fullWidth />
        </ScrollView>
      </WorkoutStoreContext.Provider>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
});
