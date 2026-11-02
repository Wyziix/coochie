import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { NeedsConnection } from '@/components/offline/NeedsConnection';
import { Button, Input, Text } from '@/components/ui';
import { useSaveMyFood } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { useNutritionStore } from '@/stores/nutritionStore';

/** Create a food (saved only for you): values per 100 g, optional serving size. */
export default function NewFoodScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();
  const save = useSaveMyFood();
  const [form, setForm] = useState({
    name: '',
    brand: '',
    kcal: '',
    protein: '',
    carbs: '',
    fat: '',
    serving: '',
    servingLabel: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const n = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : 0);

  if (!online) return <NeedsConnection message="Creating a food needs a connection." />;

  function submit() {
    setError(null);
    if (!form.name.trim()) return setError('Give it a name.');
    const kcal = n(form.kcal);
    if (!(kcal >= 0 && kcal <= 900) || !form.kcal.trim())
      return setError('Calories per 100 g: 0 to 900.');
    if ([form.protein, form.carbs, form.fat].some((v) => !(n(v) >= 0 && n(v) <= 100)))
      return setError('Macros per 100 g: 0 to 100 g.');
    if (form.serving && !(n(form.serving) > 0 && n(form.serving) <= 2000))
      return setError('Serving size: 1 to 2,000 g.');
    save.mutate(
      {
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        barcode: barcode && /^\d{6,14}$/.test(barcode) ? barcode : null,
        kcal_100g: kcal,
        protein_100g: n(form.protein),
        carbs_100g: n(form.carbs),
        fat_100g: n(form.fat),
        serving_g: form.serving ? n(form.serving) : null,
        serving_label: form.servingLabel.trim() || (form.serving ? `${n(form.serving)} g` : null),
      },
      {
        onSuccess: (food) => {
          useNutritionStore.getState().pick(food);
          router.replace('/nutrition/food');
        },
      },
    );
  }

  const half = (label: string, k: keyof typeof form) => (
    <View style={{ flex: 1 }}>
      <Input label={label} value={form[k]} onChangeText={set(k)} keyboardType="decimal-pad" />
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      <Text color="textMuted">
        Saved only for you
        {barcode ? ` (barcode ${barcode}, so scanning it finds this next time)` : ''}. Values are on
        the label, usually “per 100 g”.
      </Text>
      <Input label="Name" value={form.name} onChangeText={set('name')} maxLength={120} />
      <Input
        label="Brand (optional)"
        value={form.brand}
        onChangeText={set('brand')}
        maxLength={80}
      />
      <Text variant="label">Per 100 g</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {half('Calories (kcal)', 'kcal')}
        {half('Protein (g)', 'protein')}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {half('Carbs (g)', 'carbs')}
        {half('Fat (g)', 'fat')}
      </View>
      <Text variant="label">Serving (optional)</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {half('Serving size (g)', 'serving')}
        <View style={{ flex: 1 }}>
          <Input
            label="Serving name"
            value={form.servingLabel}
            onChangeText={set('servingLabel')}
            placeholder="e.g. 1 bar"
            maxLength={40}
          />
        </View>
      </View>
      {error || save.error ? (
        <Text color="danger">{error ?? describeError(save.error).message}</Text>
      ) : null}
      <Button title="Save food" onPress={submit} loading={save.isPending} fullWidth />
    </ScrollView>
  );
}
