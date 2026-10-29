import { Redirect, router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, IconButton, Text } from '@/components/ui';
import { ExerciseCard } from '@/components/workout/ExerciseCard';
import { RestTimerBar } from '@/components/workout/RestTimerBar';
import { useLastSets } from '@/hooks/useExercises';
import { useNow } from '@/hooks/useNow';
import { useRestTimerControls } from '@/hooks/useRestTimer';
import { useTheme } from '@/hooks/useTheme';
import { useQueryClient } from '@tanstack/react-query';

import { useSaveWorkout } from '@/hooks/useWorkouts';
import { fetchWorkoutRecords } from '@/lib/api/progress';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { formatDuration } from '@/lib/workout/format';
import { countSets, liveVolume, toSavePayload } from '@/lib/workout/payload';
import { useWorkoutStore } from '@/stores/workoutStore';

export default function ActiveWorkoutScreen() {
  const theme = useTheme();
  const workout = useWorkoutStore((s) => s.workout);
  const restRunning = useWorkoutStore((s) => s.restTimer !== null);
  const now = useNow(1000, workout !== null);
  const lastSets = useLastSets(workout?.exercises.map((e) => e.exerciseId) ?? []);
  const save = useSaveWorkout();
  const queryClient = useQueryClient();
  const rest = useRestTimerControls();
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  if (!workout) return <Redirect href="/workout" />;

  async function discard() {
    const ok = await confirm({
      title: 'Discard workout?',
      message: 'Everything logged in this workout will be deleted.',
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (!ok) return;
    await rest.skip();
    useWorkoutStore.getState().discard();
    router.replace('/workout');
  }

  async function finish() {
    setError(null);
    const current = useWorkoutStore.getState().workout!;
    const { done, undone } = countSets(current);
    if (done === 0) {
      return confirm({
        title: 'No completed sets',
        message: 'Tick off at least one set to save the workout, or discard it.',
      });
    }
    const ok = await confirm({
      title: 'Finish workout?',
      message:
        undone > 0
          ? `${undone} set${undone === 1 ? ' isn’t' : 's aren’t'} marked done and won’t be saved.`
          : undefined,
      confirmLabel: 'Finish',
    });
    if (!ok) return;

    try {
      // Stored on the device first, then sent (now if online, later if not).
      const saved = await save.mutateAsync(toSavePayload(current));
      await rest.skip();
      useWorkoutStore.getState().discard();
      if (!saved.synced) {
        router.replace({ pathname: '/workouts/[id]', params: { id: saved.id, finished: '1' } });
        return;
      }
      // The server computed records while saving; ask it what's new.
      const records = await queryClient
        .fetchQuery({
          queryKey: ['workouts', 'records', saved.id],
          queryFn: () => fetchWorkoutRecords(saved.id),
        })
        .catch(() => []);
      router.replace(
        records.length > 0
          ? { pathname: '/workouts/celebrate', params: { id: saved.id } }
          : { pathname: '/workouts/[id]', params: { id: saved.id, finished: '1' } },
      );
    } catch (e) {
      setError(`Couldn’t save: ${describeError(e).message} Your workout is kept on this device.`);
    }
  }

  const elapsed = (now - Date.parse(workout.startedAt)) / 1000;
  const { done } = countSets(workout);

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.header,
          {
            padding: theme.spacing.md,
            gap: theme.spacing.sm,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <IconButton
          icon="chevron-down"
          accessibilityLabel="Minimise workout"
          onPress={() => router.back()}
        />
        <View style={styles.flex}>
          <TextInput
            accessibilityLabel="Workout name"
            value={workout.name}
            onChangeText={(name) => useWorkoutStore.getState().rename(name)}
            maxLength={60}
            style={[theme.typography.heading, { color: theme.colors.text, padding: 0 }]}
          />
          <Text variant="caption" color="textMuted" style={styles.tabular}>
            {formatDuration(elapsed)} · {done} set{done === 1 ? '' : 's'} · {liveVolume(workout)}{' '}
            {workout.units}
          </Text>
        </View>
        <IconButton
          icon="calculator-outline"
          accessibilityLabel="Plate calculator"
          onPress={() => router.push('/workouts/plates')}
        />
        <Button title="Finish" onPress={finish} loading={save.isPending} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: theme.spacing.md,
            gap: theme.spacing.md,
            paddingBottom: restRunning ? 160 : theme.spacing.xxl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <Text color="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          {workout.exercises.length === 0 ? (
            <EmptyState icon="add-circle-outline" title="Add your first exercise" />
          ) : (
            workout.exercises.map((exercise) => (
              <ExerciseCard
                key={exercise.key}
                exercise={exercise}
                unit={workout.units}
                lastSets={lastSets.data?.[exercise.exerciseId]}
              />
            ))
          )}
          <Button
            title="Add exercises"
            variant="secondary"
            onPress={() => router.push('/exercises/pick')}
            fullWidth
          />
          <Button title="Discard workout" variant="ghost" onPress={discard} />
        </ScrollView>
      </KeyboardAvoidingView>

      <View
        style={[styles.restDock, { padding: theme.spacing.md, bottom: insets.bottom }]}
        pointerEvents="box-none"
      >
        <RestTimerBar />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabular: { fontVariant: ['tabular-nums'] },
  restDock: { position: 'absolute', left: 0, right: 0 },
});
