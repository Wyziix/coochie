import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { ProgressBar } from '@/components/points/ProgressBar';
import { OfflineNote } from '@/components/social/OfflineNote';
import { Card, ErrorState, IconButton, LoadingState, Text } from '@/components/ui';
import { useNutritionWeek, useTargets } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import { addDays, dayLabel, localDay } from '@/lib/nutrition/calc';

/** The 7 days ending on a day: averages (days with food logged) and each day vs target. */
export default function NutritionWeekScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ end?: string }>();
  const today = localDay();
  const end = params.end && /^\d{4}-\d{2}-\d{2}$/.test(params.end) ? params.end : today;
  const week = useNutritionWeek(end);
  const targets = useTargets().data;

  if (week.isPending && !week.data) return <LoadingState />;
  if (week.error && !week.data)
    return <ErrorState error={week.error} onRetry={() => week.refetch()} />;
  const w = week.data!;
  const avgRow = (label: string, value: number, target: number | undefined, unit: string) => (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row' }}>
        <Text style={{ flex: 1 }}>{label}</Text>
        <Text variant="label">
          {value}
          {target ? ` / ${target}` : ''} {unit}
        </Text>
      </View>
      {target ? <ProgressBar value={value / target} label={`${label} average vs target`} /> : null}
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconButton
          icon="chevron-back"
          accessibilityLabel="Previous week"
          onPress={() => router.setParams({ end: addDays(end, -7) })}
        />
        <Text variant="heading" style={{ flex: 1, textAlign: 'center' }}>
          {dayLabel(addDays(end, -6), today)} – {dayLabel(end, today)}
        </Text>
        <IconButton
          icon="chevron-forward"
          accessibilityLabel="Next week"
          onPress={() =>
            router.setParams({ end: addDays(end, 7) > today ? today : addDays(end, 7) })
          }
          disabled={end >= today}
        />
      </View>
      <OfflineNote updatedAt={week.dataUpdatedAt || undefined} />
      <Card>
        <Text variant="heading">Daily average</Text>
        <Text variant="caption" color="textMuted">
          {w.daysLogged
            ? `Over the ${w.daysLogged} day${w.daysLogged === 1 ? '' : 's'} with food logged`
            : 'No food logged this week'}
        </Text>
        {avgRow('Calories', w.avg.kcal, targets?.kcal, 'kcal')}
        {avgRow('Protein', w.avg.protein, targets?.protein_g, 'g')}
        {avgRow('Carbs', w.avg.carbs, targets?.carbs_g, 'g')}
        {avgRow('Fat', w.avg.fat, targets?.fat_g, 'g')}
      </Card>
      <Card>
        <Text variant="heading">Each day</Text>
        {w.days.map((d) => (
          <View key={d.day} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row' }}>
              <Text
                style={{ flex: 1 }}
                onPress={() => router.push({ pathname: '/nutrition', params: { day: d.day } })}
              >
                {dayLabel(d.day, today)}
              </Text>
              <Text color={d.logged ? 'text' : 'textMuted'}>
                {d.logged ? `${d.kcal} kcal · P ${Math.round(d.protein)} g` : 'Nothing logged'}
              </Text>
            </View>
            {d.logged && targets ? (
              <ProgressBar value={d.kcal / targets.kcal} label={`${d.day} calories vs target`} />
            ) : null}
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
