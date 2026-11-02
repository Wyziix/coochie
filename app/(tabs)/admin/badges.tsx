import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import {
  Button,
  Card,
  Chip,
  ErrorState,
  Input,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useExercises } from '@/hooks/useExercises';
import { useAdminBadges, useSaveBadge, useSetBadgeHidden } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { AdminBadge } from '@/lib/api/social';
import { describeError } from '@/lib/errors';

type RuleType = 'workout_count' | 'streak_weeks' | 'total_sets' | 'pr_weight' | 'pr_bodyweight';
const ruleTypes: { value: RuleType; label: string }[] = [
  { value: 'workout_count', label: 'Workouts' },
  { value: 'streak_weeks', label: 'Streak' },
  { value: 'total_sets', label: 'Sets' },
  { value: 'pr_weight', label: 'Lift kg' },
  { value: 'pr_bodyweight', label: 'Lift × BW' },
];
const categories: AdminBadge['category'][] = [
  'milestone',
  'consistency',
  'strength',
  'fun',
  'challenge',
];

function describeRule(
  b: Pick<AdminBadge, 'rule_type' | 'rule'>,
  exerciseName: (id?: string, slug?: string) => string,
) {
  const r = b.rule as Record<string, string | number>;
  switch (b.rule_type) {
    case 'workout_count':
      return `${r.count} workouts`;
    case 'total_sets':
      return `${r.count} working sets`;
    case 'streak_weeks':
      return `${r.weeks} weeks in a row`;
    case 'pr_weight':
      return `${exerciseName(r.exercise_id as string, r.exercise as string)} ≥ ${r.kg} kg`;
    case 'pr_bodyweight':
      return `${exerciseName(r.exercise_id as string, r.exercise as string)} ≥ ${r.ratio} × bodyweight`;
    default:
      return b.rule_type.replace('_', ' ');
  }
}

/** Admin → Badges: create, edit, hide. Saving awards or removes it for everyone. Logged. */
export default function AdminBadgesScreen() {
  const theme = useTheme();
  const badges = useAdminBadges();
  const exercises = useExercises().data ?? [];
  const hide = useSetBadgeHidden();
  const [editing, setEditing] = useState<AdminBadge | 'new' | null>(null);
  const exerciseName = (id?: string, slug?: string) =>
    exercises.find((e) => e.id === id || (slug && e.slug === slug))?.name ?? slug ?? 'exercise';

  if (badges.isPending) return <LoadingState />;
  if (badges.error) return <ErrorState error={badges.error} onRetry={() => badges.refetch()} />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      {editing ? (
        <BadgeForm badge={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <Button title="New badge" onPress={() => setEditing('new')} fullWidth />
      )}
      {badges.data.map((b) => (
        <Card key={b.id} style={{ opacity: b.is_hidden ? 0.6 : 1 }}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Ionicons name={b.icon as 'ribbon'} size={24} color={theme.colors.primary} />
            <View style={styles.flex}>
              <Text variant="label">{b.name}</Text>
              <Text variant="caption" color="textMuted">
                {describeRule(b, exerciseName)} · {b.category} · earned by {b.earned_by}
              </Text>
            </View>
          </View>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Button
              title="Edit"
              variant="ghost"
              onPress={() => setEditing(b)}
              accessibilityLabel={`Edit ${b.name}`}
            />
            <View style={styles.flex} />
            <Text variant="caption" color="textMuted">
              Hidden
            </Text>
            <Switch
              value={b.is_hidden}
              onValueChange={(v) => hide.mutate({ id: b.id, hidden: v })}
              accessibilityLabel={`Hide ${b.name}`}
              aria-checked={b.is_hidden}
              trackColor={{ true: theme.colors.danger, false: theme.colors.surfaceAlt }}
            />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

function BadgeForm({ badge, onDone }: { badge: AdminBadge | null; onDone: () => void }) {
  const theme = useTheme();
  const save = useSaveBadge();
  const exercises = useExercises().data ?? [];
  const simple = !badge || ruleTypes.some((r) => r.value === badge.rule_type);
  const r = (badge?.rule ?? {}) as Record<string, string | number>;
  const [name, setName] = useState(badge?.name ?? '');
  const [description, setDescription] = useState(badge?.description ?? '');
  const [icon, setIcon] = useState(badge?.icon ?? 'ribbon-outline');
  const [category, setCategory] = useState<AdminBadge['category']>(badge?.category ?? 'milestone');
  const [ruleType, setRuleType] = useState<RuleType>(
    (simple && badge ? badge.rule_type : 'workout_count') as RuleType,
  );
  const [value, setValue] = useState(String(r.count ?? r.weeks ?? r.kg ?? r.ratio ?? ''));
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [exerciseId, setExerciseId] = useState<string | null>(
    (r.exercise_id as string) ?? exercises.find((e) => e.slug === r.exercise)?.id ?? null,
  );
  const needsExercise = ruleType === 'pr_weight' || ruleType === 'pr_bodyweight';
  const matches =
    exerciseQuery.trim().length >= 2
      ? exercises
          .filter((e) => e.name.toLowerCase().includes(exerciseQuery.trim().toLowerCase()))
          .slice(0, 6)
      : [];

  function submit() {
    const n = Number(value.replace(',', '.'));
    const rule =
      ruleType === 'workout_count' || ruleType === 'total_sets'
        ? { count: n }
        : ruleType === 'streak_weeks'
          ? { weeks: n }
          : ruleType === 'pr_weight'
            ? { exercise_id: exerciseId, kg: n }
            : { exercise_id: exerciseId, ratio: n };
    save.mutate(
      {
        id: badge?.id ?? null,
        badge: simple
          ? { name, description, icon, category, rule_type: ruleType, rule }
          : { name, description, icon, category },
      },
      { onSuccess: onDone },
    );
  }

  return (
    <Card>
      <Text variant="heading">{badge ? `Edit “${badge.name}”` : 'New badge'}</Text>
      <Input label="Name" value={name} onChangeText={setName} maxLength={40} />
      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        maxLength={160}
      />
      <Input
        label="Icon (Ionicons name)"
        value={icon}
        onChangeText={setIcon}
        autoCapitalize="none"
        hint="e.g. ribbon-outline, flame, trophy"
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {categories.map((c) => (
          <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>
      {simple ? (
        <>
          <SegmentedControl
            options={ruleTypes}
            value={ruleType}
            onChange={setRuleType}
            accessibilityLabel="Rule"
          />
          <Input
            label={
              ruleType === 'streak_weeks'
                ? 'Weeks in a row'
                : ruleType === 'pr_weight'
                  ? 'Weight (kg)'
                  : ruleType === 'pr_bodyweight'
                    ? 'Times bodyweight (e.g. 1.5)'
                    : 'How many'
            }
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
          />
          {needsExercise ? (
            <>
              <Input
                label="Exercise"
                value={exerciseQuery}
                onChangeText={setExerciseQuery}
                placeholder="Search"
              />
              {exerciseId ? (
                <Text>Chosen: {exercises.find((e) => e.id === exerciseId)?.name}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {matches.map((e) => (
                  <Chip
                    key={e.id}
                    label={e.name}
                    selected={e.id === exerciseId}
                    onPress={() => setExerciseId(e.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : (
        <Text variant="caption" color="textMuted">
          This built-in badge’s rule can’t be changed here; name, text, icon and category can.
        </Text>
      )}
      {save.error ? <Text color="danger">{describeError(save.error).message}</Text> : null}
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Button title="Save badge" onPress={submit} loading={save.isPending} />
        <Button title="Cancel" variant="ghost" onPress={onDone} />
      </View>
      <Text variant="caption" color="textMuted">
        Saving awards (or removes) the badge for everyone right away.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
