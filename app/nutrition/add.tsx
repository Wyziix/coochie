import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { NeedsConnection } from '@/components/offline/NeedsConnection';
import { Button, Card, ChipRow, Chip, Input, LoadingState, Text } from '@/components/ui';
import { useFavorites, useFoodSearch, useLogFood, useRecentFoods } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import type { Food } from '@/lib/api/nutrition';
import { describeError } from '@/lib/errors';
import { localDay, mealLabel } from '@/lib/nutrition/calc';
import { useIsOnline } from '@/lib/offline/network';
import { useNutritionStore } from '@/stores/nutritionStore';

type Tab = 'search' | 'recent' | 'favorites' | 'quick';

/** Add food to a meal: search, recent, favourites, quick add, or scan a barcode. */
export default function AddFoodScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const { day, meal } = useNutritionStore();
  const [tab, setTab] = useState<Tab>(online ? 'search' : 'recent');
  const [query, setQuery] = useState('');
  const search = useFoodSearch(query);
  const recent = useRecentFoods();
  const favorites = useFavorites();

  const open = (food: Food) => {
    useNutritionStore.getState().pick(food);
    router.push('/nutrition/food');
  };
  const list = (foods: Food[] | undefined, empty: string) =>
    foods?.length ? (
      foods.map((f) => <FoodRow key={f.id} food={f} onPress={() => open(f)} />)
    ) : (
      <Text color="textMuted">{empty}</Text>
    );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      <Text color="textMuted">
        Adding to {mealLabel(meal).toLowerCase()} · {day === localDay() ? 'today' : day}
      </Text>
      <Button title="Scan a barcode" onPress={() => router.push('/nutrition/scan')} fullWidth />
      <ChipRow accessibilityLabel="How to add">
        {(
          [
            ['search', 'Search'],
            ['recent', 'Recent'],
            ['favorites', 'Favourites'],
            ['quick', 'Quick add'],
          ] as [Tab, string][]
        ).map(([v, l]) => (
          <Chip key={v} label={l} selected={tab === v} onPress={() => setTab(v)} />
        ))}
      </ChipRow>

      {tab === 'search' ? (
        online ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Input
              label="Search foods"
              value={query}
              onChangeText={setQuery}
              placeholder="e.g. greek yogurt"
              autoCorrect={false}
            />
            {query.trim().length >= 2 ? (
              search.isPending ? (
                <LoadingState />
              ) : search.error ? (
                <Text color="danger">{describeError(search.error).message}</Text>
              ) : (
                <>
                  {list(search.data?.foods, `Nothing found for “${query.trim()}”.`)}
                  <Button
                    title="Create a food"
                    variant="ghost"
                    onPress={() => router.push('/nutrition/new-food')}
                  />
                </>
              )
            ) : (
              <Text variant="caption" color="textMuted">
                Results from Open Food Facts and your own foods.
              </Text>
            )}
          </View>
        ) : (
          <NeedsConnection message="Searching for new foods needs a connection. Recent and favourite foods and quick add work offline." />
        )
      ) : tab === 'recent' ? (
        list(recent.data, 'Foods you log show up here.')
      ) : tab === 'favorites' ? (
        list(favorites.data, 'Tap the star on a food to keep it here.')
      ) : (
        <QuickAdd />
      )}
    </ScrollView>
  );
}

export function FoodRow({ food, onPress }: { food: Food; onPress: () => void }) {
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${food.name}${food.brand ? `, ${food.brand}` : ''}, ${Math.round(food.kcal_100g)} kcal per 100 g`}
    >
      <Text variant="label">{food.name}</Text>
      <Text variant="caption" color="textMuted">
        {[
          food.brand,
          `${Math.round(food.kcal_100g)} kcal / 100 g`,
          food.serving_label ? `serving ${food.serving_label}` : null,
          food.source === 'user' ? 'your food' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Card>
  );
}

function QuickAdd() {
  const theme = useTheme();
  const { day, meal } = useNutritionStore();
  const log = useLogFood();
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const n = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : 0);

  function save() {
    const k = n(kcal);
    if (!(k > 0) || k > 10000) return setError('Enter the calories (1 to 10,000).');
    if ([protein, carbs, fat].some((v) => !(n(v) >= 0) || n(v) > 1000))
      return setError('Macros must be 0 to 1,000 g.');
    log.mutate(
      {
        day: day ?? localDay(),
        meal,
        food_id: null,
        name: name.trim() || 'Quick add',
        grams: null,
        servings: null,
        kcal: k,
        protein: n(protein),
        carbs: n(carbs),
        fat: n(fat),
      },
      {
        onSuccess: () =>
          router.dismissTo({ pathname: '/nutrition', params: { day: day ?? localDay() } }),
      },
    );
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Input
        label="Name (optional)"
        value={name}
        onChangeText={setName}
        maxLength={120}
        placeholder="e.g. Restaurant pasta"
      />
      <Input
        label="Calories (kcal)"
        value={kcal}
        onChangeText={setKcal}
        keyboardType="decimal-pad"
      />
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            label="Protein (g)"
            value={protein}
            onChangeText={setProtein}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Carbs (g)"
            value={carbs}
            onChangeText={setCarbs}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Fat (g)" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
        </View>
      </View>
      {error ? <Text color="danger">{error}</Text> : null}
      <Button title="Add" onPress={save} loading={log.isPending} fullWidth />
    </View>
  );
}
