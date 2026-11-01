import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useFeatureLimit, FeatureLimit } from '@/components/ai/FeatureLimit';
import { ThinkingIndicator } from '@/components/ai/ThinkingIndicator';
import { NeedsConnection } from '@/components/offline/NeedsConnection';
import { Button, OptionList, SegmentedControl, Text } from '@/components/ui';
import { useGeneratePlan } from '@/hooks/usePlans';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { AiError, type PlanEquipment, type PlanRequest } from '@/lib/api/ai';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { experienceOptions, goalOptions } from '@/lib/profile/options';

const days = [2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }));
const minutes = [30, 45, 60, 75, 90].map((n) => ({ value: String(n), label: `${n}` }));
const equipment: { value: PlanEquipment; label: string; description: string }[] = [
  { value: 'full_gym', label: 'Full gym', description: 'Barbells, machines, cables, dumbbells' },
  { value: 'home_dumbbells', label: 'Home dumbbells', description: 'Dumbbells and bodyweight' },
  { value: 'bodyweight', label: 'Bodyweight only', description: 'No equipment' },
];

/** Plan generator: a few choices, then Claude builds a multi-week plan from the library. */
export default function NewPlanScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const { data: profile } = useProfile();
  const generate = useGeneratePlan();
  const limit = useFeatureLimit('plan');
  const [form, setForm] = useState<PlanRequest>(() => ({
    goal: profile?.goal ?? 'general_fitness',
    experience: profile?.experience_level ?? 'beginner',
    days_per_week: Math.min(6, Math.max(2, profile?.training_days_per_week ?? 3)),
    session_minutes: 60,
    equipment: 'full_gym',
  }));
  const set = <K extends keyof PlanRequest>(key: K, value: PlanRequest[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (!online) {
    return (
      <NeedsConnection message="Building a plan needs a connection. Your saved plans work offline." />
    );
  }

  const error =
    generate.error instanceof AiError
      ? generate.error.message
      : generate.error
        ? describeError(generate.error).message
        : null;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Text color="textMuted">
        Pick what you want and Claude builds a plan from the exercise library. You see it before
        anything is saved.
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">Goal</Text>
        <OptionList
          options={goalOptions}
          value={form.goal}
          onChange={(v) => set('goal', v)}
          accessibilityLabel="Goal"
        />
      </View>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">Experience</Text>
        <OptionList
          options={experienceOptions}
          value={form.experience}
          onChange={(v) => set('experience', v)}
          accessibilityLabel="Experience"
        />
      </View>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">Days per week</Text>
        <SegmentedControl
          options={days}
          value={String(form.days_per_week)}
          onChange={(v) => set('days_per_week', Number(v))}
          accessibilityLabel="Days per week"
        />
      </View>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">Minutes per session</Text>
        <SegmentedControl
          options={minutes}
          value={String(form.session_minutes)}
          onChange={(v) => set('session_minutes', Number(v))}
          accessibilityLabel="Minutes per session"
        />
      </View>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">Equipment</Text>
        <OptionList
          options={equipment}
          value={form.equipment}
          onChange={(v) => set('equipment', v)}
          accessibilityLabel="Equipment"
        />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        {generate.isPending ? (
          <ThinkingIndicator hint="Usually 10 to 20 seconds." />
        ) : (
          <Button
            title="Build my plan"
            onPress={() =>
              generate.mutate(form, { onSuccess: () => router.push('/plans/preview') })
            }
            disabled={limit.blocked}
            fullWidth
          />
        )}
        <FeatureLimit feature="plan" />
        {error ? <Text color="danger">{error}</Text> : null}
      </View>
    </ScrollView>
  );
}
