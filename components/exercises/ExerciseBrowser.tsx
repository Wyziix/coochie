import { useMemo, useState, type ReactElement } from 'react';
import { FlatList, ScrollView, View } from 'react-native';

import { Chip, EmptyState, ErrorState, Input, LoadingState } from '@/components/ui';
import { useExercises } from '@/hooks/useExercises';
import { useTheme } from '@/hooks/useTheme';
import type { Exercise } from '@/lib/api/exercises';
import { filterExercises } from '@/lib/exercises/filter';
import {
  equipmentOptions,
  muscleOptions,
  type Equipment,
  type MuscleGroup,
} from '@/lib/exercises/labels';

type Props = {
  renderItem: (exercise: Exercise) => ReactElement;
  /** Admin view: global exercises only, hidden ones included. */
  adminMode?: boolean;
  footer?: ReactElement;
};

/** Search + muscle and equipment filters over the exercise library. */
export function ExerciseBrowser({ renderItem, adminMode, footer }: Props) {
  const theme = useTheme();
  const { data, isPending, isError, refetch } = useExercises();
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);

  const results = useMemo(() => {
    const source = adminMode ? (data ?? []).filter((e) => e.owner_id === null) : (data ?? []);
    return filterExercises(source, { query, muscle, equipment, includeHidden: adminMode });
  }, [data, query, muscle, equipment, adminMode]);

  if (isPending) return <LoadingState message="Loading exercises" />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const chips = <T extends string>(
    options: { value: T; label: string }[],
    value: T | null,
    onChange: (v: T | null) => void,
    label: string,
  ) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      // Without flexGrow: 0 a horizontal ScrollView stretches to fill the column.
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        alignItems: 'center',
      }}
    >
      <Chip label="All" selected={value === null} onPress={() => onChange(null)} />
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          selected={value === o.value}
          onPress={() => onChange(value === o.value ? null : o.value)}
        />
      ))}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, gap: theme.spacing.sm }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <Input
          accessibilityLabel="Search exercises"
          placeholder="Search exercises"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      {chips(muscleOptions, muscle, setMuscle, 'Filter by muscle')}
      {chips(equipmentOptions, equipment, setEquipment, 'Filter by equipment')}
      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => renderItem(item)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
        }}
        initialNumToRender={20}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No exercises found"
            message="Try another search or filter."
          />
        }
        ListFooterComponent={footer}
      />
    </View>
  );
}
