import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet, Button, Card, Chip, IconButton, Text } from '@/components/ui';
import { useSaveRestSetting } from '@/hooks/useExercises';
import { useRestTimerControls } from '@/hooks/useRestTimer';
import { useTheme } from '@/hooks/useTheme';
import type { LastSet } from '@/lib/api/exercises';
import { confirm } from '@/lib/confirm';
import { tapFeedback } from '@/lib/platform/feedback';
import { formatDuration, formatRest, formatTarget, REST_OPTIONS } from '@/lib/workout/format';
import { fieldsFor, isSetComplete, placeholderFrom, withPlaceholders } from '@/lib/workout/sets';
import type { ActiveExercise } from '@/lib/workout/types';
import { useWorkoutStoreContext } from '@/stores/workoutStore';

import { SetOptionsSheet } from './SetOptionsSheet';
import { SetRow } from './SetRow';

type Props = {
  exercise: ActiveExercise;
  unit: 'kg' | 'lbs';
  lastSets?: LastSet[];
};

export function ExerciseCard({ exercise, unit, lastSets = [] }: Props) {
  const theme = useTheme();
  const { store, mode } = useWorkoutStoreContext();
  const { updateSet, addSet, removeSet, removeExercise, setExerciseRest } = store.getState();
  const live = mode === 'live';
  const rest = useRestTimerControls();
  const saveRest = useSaveRestSetting();
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const f = fieldsFor(exercise.type);
  const optionsIndex = exercise.sets.findIndex((s) => s.id === optionsFor);

  // Placeholder for each row: last time's set at the same position, else the row above.
  const placeholders = exercise.sets.map((s, i) => {
    const fromLast = placeholderFrom(lastSets[i], unit);
    const above = exercise.sets[i - 1];
    return {
      weight: fromLast.weight || above?.weight || '',
      reps:
        fromLast.reps ||
        above?.reps ||
        (exercise.target?.repsMin ? String(exercise.target.repsMin) : ''),
      duration:
        fromLast.duration ||
        above?.duration ||
        (exercise.target?.durationSeconds ? formatDuration(exercise.target.durationSeconds) : ''),
      distance: fromLast.distance || above?.distance || '',
    };
  });

  function toggleDone(index: number) {
    const set = exercise.sets[index]!;
    if (set.done) return updateSet(exercise.key, set.id, { done: false });

    const filled = withPlaceholders(set, placeholders[index]!);
    if (!isSetComplete(filled, exercise.type)) {
      setInvalid((s) => new Set(s).add(set.id));
      return;
    }
    setInvalid((s) => {
      const next = new Set(s);
      next.delete(set.id);
      return next;
    });
    updateSet(exercise.key, set.id, { ...filled, done: true });
    tapFeedback();
    // Editing a past workout: no rest timer.
    if (live) rest.start(exercise.key, exercise.restSeconds, exercise.name);
  }

  function copyPrevious(index: number) {
    const set = exercise.sets[index]!;
    updateSet(exercise.key, set.id, { ...placeholderFrom(lastSets[index], unit) });
  }

  function chooseRest(seconds: number) {
    setExerciseRest(exercise.key, seconds);
    saveRest.mutate({ exerciseId: exercise.exerciseId, seconds });
  }

  async function onRemove() {
    setMenuOpen(false);
    const ok = await confirm({
      title: `Remove ${exercise.name}?`,
      message: 'Its sets in this workout will be deleted.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) removeExercise(exercise.key);
  }

  return (
    <Card style={{ padding: theme.spacing.md }}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="heading" numberOfLines={2}>
            {exercise.name}
          </Text>
          <Text variant="caption" color="textMuted">
            {[
              exercise.target ? `Target ${formatTarget(exercise.target)}` : null,
              live ? `Rest ${formatRest(exercise.restSeconds)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <IconButton
          icon="ellipsis-horizontal"
          accessibilityLabel={`${exercise.name} options`}
          onPress={() => setMenuOpen(true)}
        />
      </View>

      <View style={[styles.columns, { gap: theme.spacing.sm }]}>
        <Text variant="caption" color="textMuted" style={styles.setCol}>
          Set
        </Text>
        {live ? (
          <Text variant="caption" color="textMuted" style={styles.prevCol}>
            Previous
          </Text>
        ) : null}
        {f.weight ? (
          <Text variant="caption" color="textMuted" style={styles.cell}>
            {exercise.type === 'bodyweight' ? `+${unit}` : unit}
          </Text>
        ) : null}
        {f.reps ? (
          <Text variant="caption" color="textMuted" style={styles.cell}>
            Reps
          </Text>
        ) : null}
        {f.duration ? (
          <Text variant="caption" color="textMuted" style={styles.cell}>
            Time
          </Text>
        ) : null}
        {f.distance ? (
          <Text variant="caption" color="textMuted" style={styles.cell}>
            {unit === 'lbs' ? 'mi' : 'km'}
          </Text>
        ) : null}
        <View style={styles.doneCol} />
      </View>

      {exercise.sets.map((set, i) => (
        <SetRow
          key={set.id}
          set={set}
          number={i + 1}
          type={exercise.type}
          unit={unit}
          last={lastSets[i]}
          placeholder={placeholders[i]!}
          invalid={invalid.has(set.id)}
          onChange={(patch) => updateSet(exercise.key, set.id, patch)}
          onToggleDone={() => toggleDone(i)}
          onOpenOptions={() => setOptionsFor(set.id)}
          onUsePrevious={() => copyPrevious(i)}
          showPrevious={live}
        />
      ))}

      <Button title="+ Add set" variant="ghost" onPress={() => addSet(exercise.key)} />

      <SetOptionsSheet
        set={optionsIndex >= 0 ? exercise.sets[optionsIndex]! : null}
        number={optionsIndex + 1}
        onClose={() => setOptionsFor(null)}
        onChange={(patch) => optionsFor && updateSet(exercise.key, optionsFor, patch)}
        onDelete={() => {
          if (optionsFor) removeSet(exercise.key, optionsFor);
          setOptionsFor(null);
        }}
      />

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={exercise.name}>
        {live ? (
          <>
            <Text variant="label" color="textMuted">
              Rest timer (saved for next time)
            </Text>
            <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
              {REST_OPTIONS.map((seconds) => (
                <Chip
                  key={seconds}
                  label={formatRest(seconds)}
                  selected={exercise.restSeconds === seconds}
                  accessibilityRole="radio"
                  onPress={() => chooseRest(seconds)}
                />
              ))}
            </View>
          </>
        ) : null}
        <Button
          title="How to do it"
          variant="secondary"
          onPress={() => {
            setMenuOpen(false);
            router.push({ pathname: '/exercises/[id]', params: { id: exercise.exerciseId } });
          }}
        />
        <Button title="Remove exercise" variant="danger" onPress={onRemove} />
      </BottomSheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  columns: { flexDirection: 'row', alignItems: 'center' },
  setCol: { width: 32, textAlign: 'center' },
  prevCol: { flex: 1.4 },
  cell: { flex: 1, textAlign: 'center' },
  doneCol: { width: 44 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
