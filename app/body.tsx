import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { LineChartCard } from '@/components/charts/LineChartCard';
import { MeasurementInput } from '@/components/profile/MeasurementInput';
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  LoadingState,
  Text,
} from '@/components/ui';
import { useDeleteMeasurement, useMeasurements, useSaveMeasurement } from '@/hooks/useBody';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import type { Measurement } from '@/lib/api/body';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { dateKey } from '@/lib/history/calendar';
import {
  emptyForm,
  formToInput,
  lengthFields,
  type MeasurementField,
  type MeasurementForm,
} from '@/lib/progress/measurements';
import { bodyValue, RANGES, rangeStart, shortDate, type Range } from '@/lib/progress/series';
import { heightUnitFor } from '@/lib/units';

type ChartKey = 'bodyweight_kg' | 'body_fat_pct' | MeasurementField;
const chartOptions: { key: ChartKey; label: string }[] = [
  { key: 'bodyweight_kg', label: 'Bodyweight' },
  { key: 'body_fat_pct', label: 'Body fat' },
  ...lengthFields.map((f) => ({ key: f.key as ChartKey, label: f.label })),
];

export default function BodyScreen() {
  const theme = useTheme();
  const unit = useProfile().data?.units ?? 'kg';
  const lengthUnit = heightUnitFor(unit);
  const { data, isPending, error, refetch } = useMeasurements();
  const save = useSaveMeasurement();
  const remove = useDeleteMeasurement();
  const [chart, setChart] = useState<ChartKey>('bodyweight_kg');
  const [range, setRange] = useState<Range>('3M');
  const [form, setForm] = useState<MeasurementForm | null>(null);
  const [date, setDate] = useState(dateKey(new Date()));
  const [formError, setFormError] = useState<string | null>(null);

  const kind =
    chart === 'bodyweight_kg' ? 'weight' : chart === 'body_fat_pct' ? 'percent' : 'length';
  const suffix = kind === 'weight' ? unit : kind === 'percent' ? '%' : lengthUnit;
  const points = useMemo(() => {
    const since = rangeStart(range);
    return (data ?? [])
      .filter((m) => m[chart] != null && (!since || m.measured_on >= dateKey(since)))
      .map((m) => ({ date: m.measured_on, value: bodyValue(m[chart] as number, kind, unit) }))
      .reverse();
  }, [data, chart, range, kind, unit]);

  function openForm(existing?: Measurement) {
    setFormError(null);
    setDate(existing?.measured_on ?? dateKey(new Date()));
    const f = emptyForm();
    if (existing) {
      if (existing.bodyweight_kg != null)
        f.bodyweight = String(bodyValue(existing.bodyweight_kg, 'weight', unit));
      if (existing.body_fat_pct != null) f.bodyFat = String(existing.body_fat_pct);
      for (const { key } of lengthFields)
        if (existing[key] != null) f[key] = String(bodyValue(existing[key]!, 'length', unit));
    }
    setForm(f);
  }

  function submit() {
    if (!form) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dateKey(new Date()))
      return setFormError('Date like 2026-10-31, not in the future');
    const result = formToInput(form, date, unit);
    if (result.input === null) return setFormError(result.error);
    save.mutate(result.input, {
      onSuccess: () => setForm(null),
      onError: (e) => setFormError(`Couldn’t save: ${describeError(e).message}`),
    });
  }

  async function onDelete(m: Measurement) {
    const ok = await confirm({
      title: `Delete the ${m.measured_on} entry?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) remove.mutate(m.id);
  }

  const describe = (m: Measurement) =>
    [
      m.bodyweight_kg != null ? `${bodyValue(m.bodyweight_kg, 'weight', unit)} ${unit}` : null,
      m.body_fat_pct != null ? `${m.body_fat_pct}% fat` : null,
      ...lengthFields
        .filter((f) => m[f.key] != null)
        .map((f) => `${f.label} ${bodyValue(m[f.key]!, 'length', unit)} ${lengthUnit}`),
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <Stack.Screen options={{ title: 'Body' }} />
      <Button
        title="Log measurements"
        onPress={() => openForm(data?.find((m) => m.measured_on === dateKey(new Date())))}
        fullWidth
      />

      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <ChipRow accessibilityLabel="Measurement">
            {chartOptions.map((o) => (
              <Chip
                key={o.key}
                label={o.label}
                selected={chart === o.key}
                accessibilityRole="radio"
                onPress={() => setChart(o.key)}
              />
            ))}
          </ChipRow>
          <ChipRow accessibilityLabel="Time range">
            {RANGES.map((r) => (
              <Chip
                key={r}
                label={r}
                selected={range === r}
                accessibilityRole="radio"
                onPress={() => setRange(r)}
              />
            ))}
          </ChipRow>
          <LineChartCard
            points={points}
            format={(v) => `${v} ${suffix}`}
            formatAxis={(v) => String(Math.round(v))}
            emptyText="No entries in this range."
          />

          <Text variant="heading">Entries</Text>
          {data && data.length > 0 ? (
            data.map((m) => (
              <Card key={m.id} style={styles.entry}>
                <View style={styles.flex}>
                  <Text variant="label">
                    {shortDate(m.measured_on)} {m.measured_on.slice(0, 4)}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {describe(m)}
                  </Text>
                </View>
                <IconButton
                  icon="create-outline"
                  accessibilityLabel={`Edit ${m.measured_on}`}
                  onPress={() => openForm(m)}
                />
                <IconButton
                  icon="trash-outline"
                  color="danger"
                  accessibilityLabel={`Delete ${m.measured_on}`}
                  onPress={() => onDelete(m)}
                />
              </Card>
            ))
          ) : (
            <EmptyState
              icon="body-outline"
              title="No measurements yet"
              message="Log your bodyweight to start a chart."
            />
          )}
        </>
      )}

      <BottomSheet visible={form !== null} onClose={() => setForm(null)} title="Log measurements">
        {form ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ gap: theme.spacing.md }}
          >
            <Input
              label="Date"
              value={date}
              onChangeText={setDate}
              placeholder="2026-10-31"
              maxLength={10}
            />
            <View style={[styles.pair, { gap: theme.spacing.md }]}>
              <View style={styles.flex}>
                <MeasurementInput
                  label="Bodyweight"
                  unit={unit}
                  value={form.bodyweight}
                  onChange={(bodyweight) => setForm({ ...form, bodyweight })}
                />
              </View>
              <View style={styles.flex}>
                <MeasurementInput
                  label="Body fat"
                  unit="%"
                  value={form.bodyFat}
                  onChange={(bodyFat) => setForm({ ...form, bodyFat })}
                />
              </View>
            </View>
            <Text variant="caption" color="textMuted">
              Optional ({lengthUnit})
            </Text>
            <View style={[styles.wrap, { gap: theme.spacing.md }]}>
              {lengthFields.map((f) => (
                <View key={f.key} style={styles.half}>
                  <MeasurementInput
                    label={f.label}
                    unit={lengthUnit}
                    value={form[f.key]}
                    onChange={(v) => setForm({ ...form, [f.key]: v })}
                  />
                </View>
              ))}
            </View>
            {formError ? <Text color="danger">{formError}</Text> : null}
            <Button title="Save" onPress={submit} loading={save.isPending} fullWidth />
          </KeyboardAvoidingView>
        ) : null}
      </BottomSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  entry: { flexDirection: 'row', alignItems: 'center' },
  pair: { flexDirection: 'row' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { flexGrow: 1, flexBasis: '40%' },
});
