import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { Button, Card, Chip, ErrorState, LoadingState, Text } from '@/components/ui';
import { useExercise } from '@/hooks/useExercises';
import { useTheme } from '@/hooks/useTheme';
import { equipmentLabels, muscleLabels, typeLabels } from '@/lib/exercises/labels';
import { formatRest } from '@/lib/workout/format';
import { useUserId } from '@/stores/authStore';

export default function ExerciseDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: exercise, isPending } = useExercise(id);
  const userId = useUserId();

  if (isPending) return <LoadingState />;
  if (!exercise) return <ErrorState title="Exercise not found" />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Stack.Screen options={{ title: exercise.name }} />
      <Text variant="title">{exercise.name}</Text>
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
          onPress={() => router.push({ pathname: '/exercises/new', params: { id: exercise.id } })}
        />
      ) : null}
    </ScrollView>
  );
}
