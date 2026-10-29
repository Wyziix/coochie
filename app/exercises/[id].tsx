import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ExerciseProgress } from '@/components/progress/ExerciseProgress';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useExercise } from '@/hooks/useExercises';
import { useTheme } from '@/hooks/useTheme';
import { equipmentLabels, muscleLabels, typeLabels } from '@/lib/exercises/labels';
import { formatRest } from '@/lib/workout/format';
import { useUserId } from '@/stores/authStore';

export default function ExerciseDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: exercise, isPending, error, refetch } = useExercise(id);
  const userId = useUserId();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: 'about' | 'progress' }>();
  const [tab, setTab] = useState<'about' | 'progress'>(initialTab ?? 'about');

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!exercise) return <ErrorState title="Exercise not found" />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Stack.Screen options={{ title: exercise.name }} />
      <Text variant="title">{exercise.name}</Text>
      <SegmentedControl
        accessibilityLabel="Exercise view"
        options={[
          { value: 'about', label: 'About' },
          { value: 'progress', label: 'Progress' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'progress' ? <ExerciseProgress exercise={exercise} /> : null}
      {tab === 'about' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Chip label={muscleLabels[exercise.primary_muscle]} selected />
            {exercise.secondary_muscles.map((m) => (
              <Chip key={m} label={muscleLabels[m]} />
            ))}
          </View>
          <Card>
            <Text color="textMuted">
              {equipmentLabels[exercise.equipment]} · {typeLabels[exercise.type]} · Rest{' '}
              {formatRest(exercise.default_rest_seconds)}
            </Text>
            <Text>{exercise.instructions ?? 'No instructions yet.'}</Text>
          </Card>
          {exercise.owner_id === userId ? (
            <Button
              title="Edit exercise"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: '/exercises/new', params: { id: exercise.id } })
              }
            />
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
