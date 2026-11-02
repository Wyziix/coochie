import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useAdminFoods, useSetFoodHidden, useUpdateFood } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import type { AdminFood } from '@/lib/api/nutrition';
import { describeError } from '@/lib/errors';

type Filter = 'all' | 'hidden' | 'visible';

/** Admin → Foods: fix or hide wrong cached Open Food Facts foods. Users' own foods and logs stay private. Logged. */
export default function AdminFoodsScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const foods = useAdminFoods(search, filter === 'all' ? null : filter === 'hidden');

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      <Text color="textMuted">
        Foods cached from Open Food Facts. Hidden foods disappear from search and barcode lookups
        (people can then add their own). Users’ own foods and food logs are private and not listed.
      </Text>
      <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-end' }]}>
        <View style={styles.flex}>
          <Input
            label="Name or barcode"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            onSubmitEditing={() => setSearch(query)}
          />
        </View>
        <Button title="Search" variant="secondary" onPress={() => setSearch(query)} />
      </View>
      <SegmentedControl
        options={[
          { value: 'all', label: 'All' },
          { value: 'visible', label: 'Shown' },
          { value: 'hidden', label: 'Hidden' },
        ]}
        value={filter}
        onChange={setFilter}
        accessibilityLabel="Filter"
      />
      {foods.isPending ? (
        <LoadingState />
      ) : foods.error ? (
        <ErrorState error={foods.error} onRetry={() => foods.refetch()} />
      ) : foods.data.length === 0 ? (
        <EmptyState icon="nutrition-outline" title="No foods" />
      ) : (
        foods.data.map((f) => <FoodCard key={f.id} food={f} />)
      )}
    </ScrollView>
  );
}

function FoodCard({ food: f }: { food: AdminFood }) {
  const theme = useTheme();
  const hide = useSetFoodHidden();
  const update = useUpdateFood();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({
    name: f.name,
    kcal: String(f.kcal_100g),
    protein: String(f.protein_100g),
    carbs: String(f.carbs_100g),
    fat: String(f.fat_100g),
  });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const num = (x: string) => Number(x.replace(',', '.'));

  return (
    <Card style={{ opacity: f.is_hidden ? 0.6 : 1 }}>
      <Text variant="label">
        {f.name}
        {f.brand ? ` · ${f.brand}` : ''}
      </Text>
      <Text variant="caption" color="textMuted">
        {f.barcode} · {f.kcal_100g} kcal · P {f.protein_100g} · C {f.carbs_100g} · F {f.fat_100g}{' '}
        per 100 g{f.serving_g ? ` · serving ${f.serving_label ?? `${f.serving_g} g`}` : ''} · logged{' '}
        {f.times_logged}×
      </Text>
      {editing ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Input label="Name" value={v.name} onChangeText={set('name')} />
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
              <View key={k} style={styles.flex}>
                <Input
                  label={k === 'kcal' ? 'kcal' : `${k} g`}
                  value={v[k]}
                  onChangeText={set(k)}
                  keyboardType="decimal-pad"
                />
              </View>
            ))}
          </View>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Button
              title="Save"
              loading={update.isPending}
              onPress={() =>
                update.mutate(
                  {
                    id: f.id,
                    changes: {
                      name: v.name.trim(),
                      kcal_100g: num(v.kcal),
                      protein_100g: num(v.protein),
                      carbs_100g: num(v.carbs),
                      fat_100g: num(v.fat),
                    },
                  },
                  { onSuccess: () => setEditing(false) },
                )
              }
            />
            <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} />
          </View>
        </View>
      ) : null}
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {!editing ? (
          <Button
            title="Fix values"
            variant="ghost"
            onPress={() => setEditing(true)}
            accessibilityLabel={`Fix ${f.name}`}
          />
        ) : null}
        <View style={styles.flex} />
        <Text variant="caption" color="textMuted">
          Hidden
        </Text>
        <Switch
          value={f.is_hidden ?? false}
          onValueChange={(h) => hide.mutate({ id: f.id, hidden: h })}
          accessibilityLabel={`Hide ${f.name}`}
          aria-checked={f.is_hidden ?? false}
          trackColor={{ true: theme.colors.danger, false: theme.colors.surfaceAlt }}
        />
      </View>
      {update.error || hide.error ? (
        <Text color="danger">{describeError(update.error ?? hide.error).message}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
