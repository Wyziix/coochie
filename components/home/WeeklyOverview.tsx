import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, Chip, ErrorState, Text } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useWeeklyOverview } from '@/hooks/useProgress';
import { useTheme } from '@/hooks/useTheme';
import { useMonthWorkouts } from '@/hooks/useWorkouts';
import { muscleLabels } from '@/lib/exercises/labels';
import { dateKey, WEEKDAYS } from '@/lib/history/calendar';
import { weekBounds } from '@/lib/progress/week';
import { formatWeight } from '@/lib/units';
import { formatDurationShort } from '@/lib/workout/format';

/** This week: workouts vs plan, volume, time, days trained, muscles worked. */
export function WeeklyOverview() {
  const theme = useTheme();
  const profile = useProfile().data;
  const unit = profile?.units ?? 'kg';
  const week = useWeeklyOverview();
  const { from, to } = weekBounds();
  // Training days come from this month's (and, early in a week, last month's) workouts, in local time.
  const thisMonth = useMonthWorkouts(from.getFullYear(), from.getMonth());
  const now = new Date();
  const nextMonth = useMonthWorkouts(now.getFullYear(), now.getMonth());
  const trained = new Set(
    [...(thisMonth.data ?? []), ...(nextMonth.data ?? [])].map((w) =>
      dateKey(new Date(w.started_at)),
    ),
  );
  const days = WEEKDAYS.map((label, i) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    return {
      label,
      key: dateKey(d),
      done: trained.has(dateKey(d)),
      today: dateKey(d) === dateKey(now),
    };
  });

  // Counts come from the workouts themselves, so ones logged offline (still
  // waiting to sync) count right away. Muscles come from the server.
  const thisWeek = new Map(
    [...(thisMonth.data ?? []), ...(nextMonth.data ?? [])]
      .filter((w) => {
        const t = Date.parse(w.started_at);
        return t >= from.getTime() && t < to.getTime();
      })
      .map((w) => [w.id, w]),
  );
  const listed = thisMonth.data !== undefined || nextMonth.data !== undefined;
  const totals = listed
    ? {
        workouts: thisWeek.size,
        volume_kg: [...thisWeek.values()].reduce((sum, w) => sum + w.total_volume_kg, 0),
        duration_seconds: [...thisWeek.values()].reduce((sum, w) => sum + w.duration_seconds, 0),
      }
    : week.data;

  if (week.error && !listed)
    return <ErrorState error={week.error} onRetry={() => week.refetch()} />;
  const o = week.data;
  const planned = profile?.training_days_per_week ?? null;

  const stat = (label: string, value: string) => (
    <View style={styles.stat}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </View>
  );

  return (
    <Card>
      <Text variant="heading">This week</Text>
      <View style={styles.stats}>
        {stat('Workouts', totals ? `${totals.workouts}${planned ? ` / ${planned}` : ''}` : '–')}
        {stat('Volume', totals ? formatWeight(totals.volume_kg, unit) : '–')}
        {stat('Time', totals ? formatDurationShort(totals.duration_seconds) : '–')}
      </View>
      <View style={[styles.days, { gap: 6 }]} accessibilityLabel="Days trained this week">
        {days.map((d) => (
          <View
            key={d.key}
            style={styles.day}
            accessibilityLabel={`${d.label}${d.done ? ', trained' : ''}`}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: d.done ? theme.colors.primary : theme.colors.surfaceAlt,
                  borderColor: d.today ? theme.colors.primary : 'transparent',
                },
              ]}
            />
            <Text variant="caption" color={d.today ? 'text' : 'textMuted'}>
              {d.label.slice(0, 2)}
            </Text>
          </View>
        ))}
      </View>
      {o && o.muscles.length > 0 ? (
        <>
          <Text variant="caption" color="textMuted">
            Muscles worked (sets)
          </Text>
          <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
            {o.muscles.slice(0, 10).map((m) => (
              <Chip
                key={m.muscle}
                label={`${muscleLabels[m.muscle]} ${Number.isInteger(m.sets) ? m.sets : m.sets.toFixed(1)}`}
                onPress={() => router.push('/progress')}
              />
            ))}
          </View>
        </>
      ) : totals && totals.workouts === 0 ? (
        <Text color="textMuted">No workouts yet this week.</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1 },
  days: { flexDirection: 'row' },
  day: { flex: 1, alignItems: 'center', gap: 4 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
