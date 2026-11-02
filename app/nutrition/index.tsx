import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DayRings } from '@/components/nutrition/DayRings';
import { WaterCard } from '@/components/nutrition/WaterCard';
import { OfflineNote } from '@/components/social/OfflineNote';
import { Button, Card, ErrorState, IconButton, LoadingState, Text } from '@/components/ui';
import { useCopyMeal, useDeleteFoodLog, useNutritionDay, useTargets } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import type { Meal } from '@/lib/api/nutrition';
import { confirm } from '@/lib/confirm';
import {
  addDays,
  dayLabel,
  localDay,
  mealLabel,
  meals,
  portionLabel,
  totals,
} from '@/lib/nutrition/calc';
import { useNutritionStore } from '@/stores/nutritionStore';

/** One day: rings vs targets, water, and the four meals. Works offline. */
export default function NutritionDayScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ day?: string }>();
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : localDay();
  const today = localDay();
  const data = useNutritionDay(day);
  const yesterday = useNutritionDay(addDays(day, -1));
  const targets = useTargets();
  const remove = useDeleteFoodLog();
  const copy = useCopyMeal();

  const go = (d: string) => router.setParams({ day: d });
  const add = (meal: Meal) => {
    useNutritionStore.getState().setTarget(day, meal);
    router.push('/nutrition/add');
  };

  if (data.isPending && !data.data) return <LoadingState />;
  if (data.error && !data.data)
    return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const d = data.data!;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <View style={styles.row}>
        <IconButton
          icon="chevron-back"
          accessibilityLabel="Previous day"
          onPress={() => go(addDays(day, -1))}
        />
        <Text variant="heading" style={[styles.flex, styles.center]}>
          {dayLabel(day, today)}
        </Text>
        <IconButton
          icon="chevron-forward"
          accessibilityLabel="Next day"
          onPress={() => go(addDays(day, 1))}
          disabled={day >= today}
        />
      </View>
      <OfflineNote updatedAt={data.dataUpdatedAt || undefined} />

      <Card>
        <DayRings totals={d.totals} targets={targets.data} />
        {!targets.data && !targets.isPending ? (
          <Button
            title="Set your daily targets"
            variant="secondary"
            onPress={() => router.push('/nutrition/targets')}
          />
        ) : targets.data ? (
          <Text variant="caption" color="textMuted" style={styles.center}>
            {Math.max(0, targets.data.kcal - d.totals.kcal)} kcal left
          </Text>
        ) : null}
      </Card>

      <WaterCard
        day={day}
        water={d.water}
        total={d.water_ml}
        goal={targets.data?.water_ml ?? 2500}
      />

      {meals.map((m) => {
        const items = d.logs.filter((l) => l.meal === m.value);
        const t = totals(items);
        const prev = yesterday.data?.logs.filter((l) => l.meal === m.value) ?? [];
        return (
          <Card key={m.value}>
            <View style={styles.row}>
              <Text variant="heading" style={styles.flex}>
                {m.label}
              </Text>
              <Text color="textMuted">{t.kcal} kcal</Text>
            </View>
            {items.map((l) => (
              <View key={l.id} style={[styles.row, { gap: theme.spacing.sm }]}>
                <View style={styles.flex}>
                  <Text>{l.name}</Text>
                  <Text variant="caption" color="textMuted">
                    {portionLabel(l)} · {Math.round(l.kcal)} kcal · P {Math.round(l.protein)} C{' '}
                    {Math.round(l.carbs)} F {Math.round(l.fat)}
                    {'sync' in l && l.sync ? ' · waiting to sync' : ''}
                  </Text>
                </View>
                <IconButton
                  icon="trash-outline"
                  accessibilityLabel={`Delete ${l.name}`}
                  onPress={async () => {
                    if (
                      await confirm({
                        title: `Delete ${l.name}?`,
                        confirmLabel: 'Delete',
                        destructive: true,
                      })
                    )
                      remove.mutate(l);
                  }}
                />
              </View>
            ))}
            <View style={[styles.row, { gap: theme.spacing.sm, flexWrap: 'wrap' }]}>
              <Button
                title={`Add to ${m.label.toLowerCase()}`}
                variant="secondary"
                onPress={() => add(m.value)}
              />
              {!items.length && prev.length ? (
                <Button
                  title={`Copy yesterday’s ${mealLabel(m.value).toLowerCase()}`}
                  variant="ghost"
                  onPress={() => copy.mutate({ from: prev, to: day, meal: m.value })}
                  disabled={copy.isPending}
                />
              ) : null}
            </View>
          </Card>
        );
      })}

      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <View style={styles.flex}>
          <Button
            title="Week"
            variant="secondary"
            onPress={() => router.push({ pathname: '/nutrition/week', params: { end: day } })}
            fullWidth
          />
        </View>
        <View style={styles.flex}>
          <Button
            title="Targets"
            variant="secondary"
            onPress={() => router.push('/nutrition/targets')}
            fullWidth
          />
        </View>
      </View>
      <Text variant="caption" color="textMuted">
        Only you can see what you eat. It’s never shared with friends, the feed or leaderboards.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
});
