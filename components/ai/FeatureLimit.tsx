import { Text } from '@/components/ui';
import { useFeatureStatus } from '@/hooks/useAi';
import type { AiFeature } from '@/lib/api/ai';

const WHAT: Record<AiFeature, [string, string]> = {
  workout_feedback: ['AI request', 'AI requests'],
  plan: ['plan', 'plans'],
  coach: ['message', 'messages'],
};

/** "1 of 2 plans left today", or why the feature can't be used right now. */
export function useFeatureLimit(feature: AiFeature) {
  const { data, feature: f } = useFeatureStatus(feature);
  const [one, many] = WHAT[feature];
  if (data && !data.enabled)
    return { blocked: true, text: 'AI features are switched off right now.' };
  if (data?.paused_for_budget)
    return {
      blocked: true,
      text: 'AI is paused for today because the daily spending limit was reached. It’s back tomorrow.',
    };
  if (!f) return { blocked: false, text: '' };
  if (f.remaining <= 0)
    return {
      blocked: true,
      text: `You’ve used your ${f.limit} ${f.limit === 1 ? one : many} for today. You get new ones tomorrow.`,
    };
  return {
    blocked: false,
    text: `${f.remaining} of ${f.limit} ${f.limit === 1 ? one : many} left today`,
  };
}

export function FeatureLimit({ feature }: { feature: AiFeature }) {
  const { text, blocked } = useFeatureLimit(feature);
  if (!text) return null;
  return (
    <Text variant="caption" color={blocked ? 'danger' : 'textMuted'}>
      {text}
    </Text>
  );
}
