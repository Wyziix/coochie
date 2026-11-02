import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, ErrorState, Input, LoadingState, Text } from '@/components/ui';
import { usePointsSettings, useUpdatePointsSettings } from '@/hooks/usePoints';
import { useTheme } from '@/hooks/useTheme';
import type { PointsSettings } from '@/lib/api/points';
import { describeError } from '@/lib/errors';

type NumberKey = {
  [K in keyof PointsSettings]: PointsSettings[K] extends number ? K : never;
}[keyof PointsSettings];

const groups: { title: string; note?: string; fields: [NumberKey, string][] }[] = [
  {
    title: 'Per workout',
    fields: [
      ['workout_points', 'Points per workout'],
      ['min_working_sets', 'Working sets needed'],
      ['set_points', 'Points per working set'],
      ['set_points_cap', 'Max set points per workout'],
      ['pr_points', 'Points per PR'],
      ['pr_cap', 'Max PRs counted per workout'],
      ['daily_cap', 'Max points per day'],
    ],
  },
  {
    title: 'Per week',
    note: 'Weekly goal = the user’s planned days, kept between the min and max.',
    fields: [
      ['weekly_goal_points', 'Weekly goal points'],
      ['goal_min_days', 'Goal min days'],
      ['goal_max_days', 'Goal max days'],
      ['streak_points', 'Streak points per week in a row'],
      ['streak_cap_weeks', 'Streak counts up to (weeks)'],
    ],
  },
  {
    title: 'Levels',
    note: 'Level L needs base × (L − 1)^exponent points.',
    fields: [
      ['level_base', 'Base'],
      ['level_exponent', 'Exponent'],
    ],
  },
  {
    title: 'Anti-cheat',
    note: 'Applies to workouts saved from now on. Heaviest believable set = bodyweight × muscle ratio × equipment factor (ratios are in the database).',
    fields: [
      ['flag_min_minutes', 'Flag workouts shorter than (min)'],
      ['flag_max_workouts_per_day', 'Max workouts per day'],
      ['flag_backdate_days', 'Flag if logged more than (days) later'],
      ['flag_jump_pct', 'Flag jumps over previous best (%)'],
      ['flag_jump_min_kg', 'Only jumps of at least (kg)'],
      ['flag_max_set_kg', 'Heaviest set ever believable (kg)'],
      ['flag_default_bodyweight_kg', 'Bodyweight if unknown (kg)'],
    ],
  },
];

/** Admin → Points: every point value, cap and threshold. Saving recalculates everyone's points. */
export default function AdminPointsScreen() {
  const settings = usePointsSettings();
  if (settings.isPending) return <LoadingState />;
  if (settings.error)
    return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  return <Form settings={settings.data} />;
}

function Form({ settings }: { settings: PointsSettings }) {
  const theme = useTheme();
  const update = useUpdatePointsSettings();
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.fields.map(([k]) => [k, String(settings[k])]))),
  );
  const [saved, setSaved] = useState(false);

  function save() {
    const changes: Record<string, number> = {};
    for (const [k] of groups.flatMap((g) => g.fields)) {
      const n = Number(form[k]!.replace(',', '.'));
      if (n !== Number(settings[k])) changes[k] = n;
    }
    if (Object.keys(changes).length === 0) return setSaved(true);
    update.mutate(changes as Partial<PointsSettings>, { onSuccess: () => setSaved(true) });
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Text color="textMuted">
        Points reward training regularly over lifting heavy, so everyone can compete. Saving
        recalculates everyone’s points. Every change is logged.
      </Text>
      {groups.map((g) => (
        <Card key={g.title}>
          <Text variant="heading">{g.title}</Text>
          {g.note ? (
            <Text variant="caption" color="textMuted">
              {g.note}
            </Text>
          ) : null}
          <View style={[styles.grid, { gap: theme.spacing.md }]}>
            {g.fields.map(([k, label]) => (
              <View key={k} style={styles.cell}>
                <Input
                  label={label}
                  value={form[k]}
                  onChangeText={(v) => {
                    setSaved(false);
                    setForm((f) => ({ ...f, [k]: v }));
                  }}
                  keyboardType="decimal-pad"
                />
              </View>
            ))}
          </View>
        </Card>
      ))}
      <Button title="Save" onPress={save} loading={update.isPending} fullWidth />
      {update.error ? <Text color="danger">{describeError(update.error).message}</Text> : null}
      {saved && !update.error ? <Text color="success">Saved. Points recalculated.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexGrow: 1, flexBasis: 220 },
});
