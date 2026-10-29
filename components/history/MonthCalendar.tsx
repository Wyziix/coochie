import { Pressable, StyleSheet, View } from 'react-native';

import { IconButton, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { monthGrid, monthLabel, WEEKDAYS } from '@/lib/history/calendar';

type Props = {
  year: number;
  month: number;
  /** date keys ("YYYY-MM-DD") with at least one workout → count */
  trainingDays: Record<string, number>;
  selected: string | null;
  onSelect: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  canGoNext: boolean;
};

/** Month grid, Monday first. Cells are flexible, so it fits 390 px phones and the 600 px web column. */
export function MonthCalendar({
  year,
  month,
  trainingDays,
  selected,
  onSelect,
  onPrev,
  onNext,
  canGoNext,
}: Props) {
  const theme = useTheme();
  const weeks = monthGrid(year, month);
  const count = Object.entries(trainingDays).filter(([k]) =>
    k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`),
  ).length;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Previous month" onPress={onPrev} />
        <View style={styles.title}>
          <Text variant="heading" accessibilityRole="header">
            {monthLabel(year, month)}
          </Text>
          <Text variant="caption" color="textMuted">
            {count} training day{count === 1 ? '' : 's'}
          </Text>
        </View>
        <IconButton
          icon="chevron-forward"
          accessibilityLabel="Next month"
          onPress={onNext}
          disabled={!canGoNext}
        />
      </View>

      <View style={styles.week}>
        {WEEKDAYS.map((d) => (
          <Text key={d} variant="caption" color="textMuted" style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={week[0]!.key} style={styles.week}>
          {week.map((day) => {
            const trained = (trainingDays[day.key] ?? 0) > 0;
            const isSelected = selected === day.key;
            return (
              <Pressable
                key={day.key}
                accessibilityRole="button"
                accessibilityLabel={`${day.key}${trained ? `, ${trainingDays[day.key]} workout(s)` : ''}`}
                aria-selected={isSelected}
                onPress={() => onSelect(day.key)}
                style={({ pressed }) => [
                  styles.cell,
                  {
                    borderRadius: theme.radius.md,
                    backgroundColor: isSelected
                      ? theme.colors.primary
                      : trained
                        ? theme.colors.surfaceAlt
                        : 'transparent',
                    borderColor: day.isToday ? theme.colors.primary : 'transparent',
                    opacity: pressed ? 0.7 : day.inMonth ? 1 : 0.35,
                  },
                ]}
              >
                <Text variant="label" color={isSelected ? 'onPrimary' : 'text'}>
                  {day.day}
                </Text>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: trained
                        ? isSelected
                          ? theme.colors.onPrimary
                          : theme.colors.primary
                        : 'transparent',
                    },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, alignItems: 'center' },
  week: { flexDirection: 'row', gap: 4 },
  weekday: { flex: 1, textAlign: 'center' },
  cell: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    gap: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
