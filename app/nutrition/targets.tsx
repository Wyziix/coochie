import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Button,
  Card,
  Input,
  LoadingState,
  OptionList,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useSaveTargets, useTargets } from '@/hooks/useNutrition';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import type { Targets } from '@/lib/api/nutrition';
import type { Profile } from '@/lib/api/profiles';
import { describeError } from '@/lib/errors';
import { activityOptions, suggestTargets, type Activity, type Sex } from '@/lib/nutrition/targets';
import { useIsOnline } from '@/lib/offline/network';

const LB = 2.20462;

/** Daily targets: type them, or get a suggestion (Mifflin-St Jeor) and adjust. */
export default function TargetsScreen() {
  const { data: profile, isPending: profilePending } = useProfile();
  const targets = useTargets();
  if (targets.isPending || profilePending) return <LoadingState />;
  return <TargetsForm initial={targets.data ?? null} profile={profile ?? null} />;
}

function TargetsForm({ initial, profile }: { initial: Targets | null; profile: Profile | null }) {
  const theme = useTheme();
  const online = useIsOnline();
  const save = useSaveTargets();
  const lbs = profile?.units === 'lbs';
  const [form, setForm] = useState(() =>
    initial
      ? {
          kcal: String(initial.kcal),
          protein: String(initial.protein_g),
          carbs: String(initial.carbs_g),
          fat: String(initial.fat_g),
          water: String(initial.water_ml),
        }
      : { kcal: '', protein: '', carbs: '', fat: '', water: '2500' },
  );
  const [method, setMethod] = useState<'manual' | 'mifflin_st_jeor'>(initial?.method ?? 'manual');
  const [details, setDetails] = useState<Record<string, unknown>>(initial?.details ?? {});
  const [sex, setSex] = useState<Sex>((initial?.details?.sex as Sex) ?? 'male');
  const [age, setAge] = useState(String(initial?.details?.age ?? '25'));
  const [weight, setWeight] = useState(() =>
    profile?.bodyweight_kg
      ? String(Math.round((lbs ? profile.bodyweight_kg * LB : profile.bodyweight_kg) * 10) / 10)
      : '',
  );
  const [height, setHeight] = useState(() =>
    profile?.height_cm
      ? String(lbs ? Math.round(profile.height_cm / 2.54) : Math.round(profile.height_cm))
      : '',
  );
  const [activity, setActivity] = useState<Activity>(
    (initial?.details?.activity as Activity) ?? 'moderate',
  );
  const [steps, setSteps] = useState<string[]>(
    Array.isArray(initial?.details?.steps) ? (initial!.details.steps as string[]) : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const num = (v: string) => Number(v.replace(',', '.'));
  const set = (k: keyof typeof form) => (v: string) => {
    setSaved(false);
    setMethod('manual');
    setForm((f) => ({ ...f, [k]: v }));
  };

  function suggest() {
    setError(null);
    const kg = lbs ? num(weight) / LB : num(weight);
    const cm = lbs ? num(height) * 2.54 : num(height);
    const a = num(age);
    if (!(kg >= 30 && kg <= 300) || !(cm >= 120 && cm <= 230) || !(a >= 14 && a <= 99)) {
      return setError('Check age, bodyweight and height.');
    }
    const s = suggestTargets({
      sex,
      age: a,
      weightKg: kg,
      heightCm: cm,
      activity,
      goal: profile?.goal ?? 'general_fitness',
    });
    setForm({
      kcal: String(s.kcal),
      protein: String(s.protein_g),
      carbs: String(s.carbs_g),
      fat: String(s.fat_g),
      water: String(s.water_ml),
    });
    setMethod('mifflin_st_jeor');
    setSteps(s.steps);
    setDetails({
      sex,
      age: a,
      weight_kg: Math.round(kg * 10) / 10,
      height_cm: Math.round(cm),
      activity,
      goal: profile?.goal,
      bmr: s.bmr,
      tdee: s.tdee,
      steps: s.steps,
    });
    setSaved(false);
  }

  function submit() {
    setError(null);
    const t = {
      kcal: num(form.kcal),
      protein_g: num(form.protein),
      carbs_g: num(form.carbs),
      fat_g: num(form.fat),
      water_ml: num(form.water),
    };
    if (!(t.kcal >= 800 && t.kcal <= 8000)) return setError('Calories: 800 to 8,000 kcal.');
    if ([t.protein_g, t.carbs_g, t.fat_g].some((x) => !(x >= 0 && x <= 1000)))
      return setError('Macros must be 0 to 1,000 g.');
    if (!(t.water_ml >= 500 && t.water_ml <= 8000)) return setError('Water: 500 to 8,000 ml.');
    save.mutate(
      {
        ...t,
        kcal: Math.round(t.kcal),
        protein_g: Math.round(t.protein_g),
        carbs_g: Math.round(t.carbs_g),
        fat_g: Math.round(t.fat_g),
        water_ml: Math.round(t.water_ml),
        method,
        details: method === 'manual' ? {} : details,
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  const field = (label: string, k: keyof typeof form) => (
    <View style={{ flexGrow: 1, flexBasis: 140 }}>
      <Input label={label} value={form[k]} onChangeText={set(k)} keyboardType="number-pad" />
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <Text variant="heading">Daily targets</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
          {field('Calories (kcal)', 'kcal')}
          {field('Protein (g)', 'protein')}
          {field('Carbs (g)', 'carbs')}
          {field('Fat (g)', 'fat')}
          {field('Water (ml)', 'water')}
        </View>
        {method === 'mifflin_st_jeor' && steps.length ? (
          <View style={{ gap: 2 }}>
            <Text variant="label">How this was worked out</Text>
            {steps.map((s) => (
              <Text key={s} variant="caption" color="textMuted">
                {s}
              </Text>
            ))}
            <Text variant="caption" color="textMuted">
              A starting point: adjust after 2–3 weeks if your weight moves differently than you
              want.
            </Text>
          </View>
        ) : null}
        {error || save.error ? (
          <Text color="danger">{error ?? describeError(save.error).message}</Text>
        ) : null}
        <Button
          title="Save targets"
          onPress={submit}
          loading={save.isPending}
          disabled={!online}
          fullWidth
        />
        {!online ? (
          <Text variant="caption" color="textMuted">
            Saving targets needs a connection.
          </Text>
        ) : null}
        {saved && !save.error ? <Text color="success">Saved.</Text> : null}
        {saved ? (
          <Button title="Back to today" variant="ghost" onPress={() => router.back()} />
        ) : null}
      </Card>

      <Card>
        <Text variant="heading">Suggest targets</Text>
        <Text variant="caption" color="textMuted">
          Mifflin-St Jeor formula for your resting burn, times your activity, adjusted for your goal
          ({profile?.goal?.replace('_', ' ') ?? 'general fitness'}).
        </Text>
        <SegmentedControl
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
          value={sex}
          onChange={setSex}
          accessibilityLabel="Sex (for the formula)"
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
          <View style={{ flexGrow: 1, flexBasis: 100 }}>
            <Input label="Age" value={age} onChangeText={setAge} keyboardType="number-pad" />
          </View>
          <View style={{ flexGrow: 1, flexBasis: 100 }}>
            <Input
              label={`Bodyweight (${lbs ? 'lbs' : 'kg'})`}
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flexGrow: 1, flexBasis: 100 }}>
            <Input
              label={`Height (${lbs ? 'in' : 'cm'})`}
              value={height}
              onChangeText={setHeight}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <OptionList
          options={activityOptions}
          value={activity}
          onChange={setActivity}
          accessibilityLabel="Activity"
        />
        <Button title="Suggest" variant="secondary" onPress={suggest} fullWidth />
      </Card>
    </ScrollView>
  );
}
