import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { ExerciseBrowser } from '@/components/exercises/ExerciseBrowser';
import { ExerciseRow } from '@/components/exercises/ExerciseRow';
import { Button } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

export default function AdminExercisesScreen() {
  const theme = useTheme();
  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: theme.spacing.md }}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button title="Add" variant="ghost" onPress={() => router.push('/admin/exercise')} />
          ),
        }}
      />
      <ExerciseBrowser
        adminMode
        renderItem={(e) => (
          <ExerciseRow
            exercise={e}
            onPress={() => router.push({ pathname: '/admin/exercise', params: { id: e.id } })}
          />
        )}
      />
    </View>
  );
}
