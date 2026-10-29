import { useMemo, useState, type ReactElement } from 'react';
import { FlatList, View } from 'react-native';

import { Chip, ChipRow, EmptyState, ErrorState, Input, LoadingState, Text } from '@/components/ui';
import { useExercises } from '@/hooks/useExercises';
import { useTheme } from '@/hooks/useTheme';
import type { Exercise } from '@/lib/api/exercises';
import { filterExercises, withRecentSection } from '@/lib/exercises/filter';
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
  /** Shown in a "Recent" section at the top, in this order. */
  recentIds?: string[];
  footer?: ReactElement;
};

/** Search + muscle and equipment filters over the exercise library. */
export function ExerciseBrowser({ renderItem, adminMode, recentIds = [], footer }: Props) {
  const theme = useTheme();
  const { data, isPending, error, refetch, fetchStatus } = useExercises();
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);

  const items = useMemo(() => {
    const source = adminMode ? (data ?? []).filter((e) => e.owner_id === null) : (data ?? []);
    const results = filterExercises(source, { query, muscle, equipment, includeHidden: adminMode });
    return withRecentSection(results, recentIds);
  }, [data, query, muscle, equipment, adminMode, recentIds]);

  // The browser reports no connection: TanStack pauses the request instead of failing.
  if (isPending && fetchStatus === 'paused') {
    return <ErrorState error={new TypeError('Failed to fetch')} onRetry={() => refetch()} />;
  }
  if (isPending) return <LoadingState message="Loading exercises" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const chips = <T extends string>(
    options: { value: T; label: string }[],
    value: T | null,
    onChange: (v: T | null) => void,
    label: string,
  ) => (
    <ChipRow accessibilityLabel={label}>
      <Chip label="All" selected={value === null} onPress={() => onChange(null)} />
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          selected={value === o.value}
          onPress={() => onChange(value === o.value ? null : o.value)}
        />
      ))}
    </ChipRow>
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
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <Text
              variant="label"
              color="textMuted"
              accessibilityRole="header"
              style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.xs }}
            >
              {item.title}
            </Text>
          ) : (
            renderItem(item.exercise)
          )
        }
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
