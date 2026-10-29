import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';

import { MonthCalendar } from '@/components/history/MonthCalendar';
import { WorkoutRow } from '@/components/workouts/WorkoutRow';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { useMonthWorkouts, useWorkoutHistory } from '@/hooks/useWorkouts';
import { dateKey, groupByMonth } from '@/lib/history/calendar';

type View_ = 'list' | 'calendar';

export default function HistoryScreen() {
  const theme = useTheme();
  const [view, setView] = useState<View_>('list');
  const unit = useProfile().data?.units ?? 'kg';

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ title: 'History' }} />
      <View style={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <SegmentedControl
          accessibilityLabel="History view"
          options={[
            { value: 'list', label: 'List' },
            { value: 'calendar', label: 'Calendar' },
          ]}
          value={view}
          onChange={setView}
        />
      </View>
      {view === 'list' ? <HistoryList unit={unit} /> : <HistoryCalendar unit={unit} />}
    </View>
  );
}

function HistoryList({ unit }: { unit: 'kg' | 'lbs' }) {
  const theme = useTheme();
  const history = useWorkoutHistory();
  const sections = useMemo(() => groupByMonth(history.data?.pages.flat() ?? []), [history.data]);

  if (history.isPending) return <LoadingState message="Loading history" />;
  if (history.error) return <ErrorState error={history.error} onRetry={() => history.refetch()} />;

  return (
    <SectionList
      sections={sections}
      keyExtractor={(w) => w.id}
      renderItem={({ item }) => (
        <View style={{ paddingBottom: theme.spacing.sm }}>
          <WorkoutRow workout={item} unit={unit} />
        </View>
      )}
      renderSectionHeader={({ section }) => (
        <Text
          variant="label"
          color="textMuted"
          accessibilityRole="header"
          style={{
            backgroundColor: theme.colors.background,
            paddingVertical: theme.spacing.sm,
          }}
        >
          {section.title} · {section.data.length}
        </Text>
      )}
      stickySectionHeadersEnabled
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xxl,
      }}
      onEndReached={() =>
        history.hasNextPage && !history.isFetchingNextPage && history.fetchNextPage()
      }
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <EmptyState
          icon="calendar-outline"
          title="No workouts yet"
          message="Finished workouts show up here."
        />
      }
      ListFooterComponent={
        history.hasNextPage ? (
          <Button
            title="Load more"
            variant="ghost"
            onPress={() => history.fetchNextPage()}
            loading={history.isFetchingNextPage}
          />
        ) : undefined
      }
    />
  );
}

function HistoryCalendar({ unit }: { unit: 'kg' | 'lbs' }) {
  const theme = useTheme();
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState<string | null>(dateKey(today));
  const month = useMonthWorkouts(cursor.year, cursor.month);

  const monthData = month.data;
  const byDay = useMemo(() => {
    const map: Record<string, NonNullable<typeof monthData>> = {};
    for (const w of monthData ?? []) (map[dateKey(new Date(w.started_at))] ??= []).push(w);
    return map;
  }, [monthData]);
  const counts = Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, v.length]));
  const dayWorkouts = selected ? (byDay[selected] ?? []) : [];

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();

  return (
    <SectionList
      sections={[{ key: 'day', data: dayWorkouts }]}
      keyExtractor={(w) => w.id}
      contentContainerStyle={{ padding: theme.spacing.lg, paddingTop: 0, gap: theme.spacing.sm }}
      ListHeaderComponent={
        <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.md }}>
          <MonthCalendar
            year={cursor.year}
            month={cursor.month}
            trainingDays={counts}
            selected={selected}
            onSelect={setSelected}
            onPrev={() => move(-1)}
            onNext={() => move(1)}
            canGoNext={!isCurrentMonth}
          />
          {month.error ? <ErrorState error={month.error} onRetry={() => month.refetch()} /> : null}
          {selected ? (
            <Text variant="label" color="textMuted">
              {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ paddingBottom: theme.spacing.sm }}>
          <WorkoutRow workout={item} unit={unit} showDate={false} />
        </View>
      )}
      ListFooterComponent={
        selected && dayWorkouts.length === 0 && !month.isPending ? (
          <Text color="textMuted">No workout this day.</Text>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
