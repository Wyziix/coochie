import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Card, IconButton, Input, SegmentedControl, Text } from '@/components/ui';
import { useFavorites, useLogFood, useToggleFavorite } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import type { Meal } from '@/lib/api/nutrition';
import { localDay, meals, portion } from '@/lib/nutrition/calc';
import { useNutritionStore } from '@/stores/nutritionStore';

/** Pick the portion (grams or servings) and add it to a meal. */
export default function FoodScreen() {
  const theme = useTheme();
  const { food, day, meal: startMeal } = useNutritionStore();
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const log = useLogFood();
  const [unit, setUnit] = useState<'g' | 'serving'>(food?.serving_g ? 'serving' : 'g');
  const [amount, setAmount] = useState(food?.serving_g ? '1' : '100');
  const [meal, setMeal] = useState<Meal>(startMeal);

  if (!food) return <Redirect href="/nutrition" />;
  const n = Number(amount.replace(',', '.'));
  const valid = Number.isFinite(n) && n > 0 && n <= (unit === 'g' ? 5000 : 100);
  const v = valid ? portion(food, unit === 'g' ? { grams: n } : { servings: n }) : null;
  const isFavorite = favorites.data.some((f) => f.id === food.id);
  const target = day ?? localDay();

  function add() {
    if (!v) return;
    log.mutate(
      {
        day: target,
        meal,
        food_id: food!.id,
        name: food!.name,
        grams: unit === 'g' ? n : v.grams,
        servings: unit === 'serving' ? n : null,
        kcal: v.kcal,
        protein: v.protein,
        carbs: v.carbs,
        fat: v.fat,
      },
      { onSuccess: () => router.dismissTo({ pathname: '/nutrition', params: { day: target } }) },
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text variant="title">{food.name}</Text>
          {food.brand ? <Text color="textMuted">{food.brand}</Text> : null}
        </View>
        <IconButton
          icon={isFavorite ? 'star' : 'star-outline'}
          accessibilityLabel={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
          onPress={() => toggle.mutate({ food, favorite: !isFavorite })}
        />
      </View>
      <Card>
        <Text variant="label">Per 100 g</Text>
        <Text color="textMuted">
          {food.kcal_100g} kcal · protein {food.protein_100g} g · carbs {food.carbs_100g} g · fat{' '}
          {food.fat_100g} g
        </Text>
        {food.serving_g ? (
          <>
            <Text variant="label">Per serving ({food.serving_label ?? `${food.serving_g} g`})</Text>
            <Text color="textMuted">
              {(() => {
                const s = portion(food, { servings: 1 })!;
                return `${s.kcal} kcal · protein ${s.protein} g · carbs ${s.carbs} g · fat ${s.fat} g`;
              })()}
            </Text>
          </>
        ) : null}
      </Card>
      {food.serving_g ? (
        <SegmentedControl
          options={[
            { value: 'serving', label: 'Servings' },
            { value: 'g', label: 'Grams' },
          ]}
          value={unit}
          onChange={(u) => {
            setUnit(u);
            setAmount(u === 'g' ? String(food.serving_g ?? 100) : '1');
          }}
          accessibilityLabel="Portion in"
        />
      ) : null}
      <Input
        label={
          unit === 'g' ? 'Amount (g)' : `Servings (${food.serving_label ?? `${food.serving_g} g`})`
        }
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        error={amount && !valid ? 'Enter an amount above 0' : undefined}
      />
      <SegmentedControl options={meals} value={meal} onChange={setMeal} accessibilityLabel="Meal" />
      {v ? (
        <Card>
          <Text variant="heading">{Math.round(v.kcal)} kcal</Text>
          <Text color="textMuted">
            {v.grams} g · protein {v.protein} g · carbs {v.carbs} g · fat {v.fat} g
          </Text>
        </Card>
      ) : null}
      <Button title="Add to log" onPress={add} disabled={!v} loading={log.isPending} fullWidth />
    </ScrollView>
  );
}
