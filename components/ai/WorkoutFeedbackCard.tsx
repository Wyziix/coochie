import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useAiStatus, useRequestFeedback, useWorkoutFeedback } from '@/hooks/useAi';
import { useTheme } from '@/hooks/useTheme';
import { AiError } from '@/lib/api/ai';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

import { FeedbackList, SeeProfessional } from './FeedbackSections';

type Props = {
  workoutId: string;
  /** The workout is still waiting to sync (logged offline). */
  waitingToSync: boolean;
  /** When the workout last changed (to tell if the feedback is out of date). */
  workoutUpdatedAt: string;
};

/**
 * "Get AI feedback" on the workout summary. Not automatic, to save calls;
 * saved feedback is shown again for free.
 */
export function WorkoutFeedbackCard({ workoutId, waitingToSync, workoutUpdatedAt }: Props) {
  const theme = useTheme();
  const online = useIsOnline();
  const status = useAiStatus();
  const saved = useWorkoutFeedback(workoutId, !waitingToSync);
  const request = useRequestFeedback(workoutId);
  const [message, setMessage] = useState<string | null>(null);

  const feedback = saved.data;
  const stale = !!feedback?.source_updated_at && workoutUpdatedAt > feedback.source_updated_at;

  async function ask(regenerate: boolean) {
    setMessage(null);
    try {
      await request.mutateAsync(regenerate);
    } catch (e) {
      setMessage(e instanceof AiError ? e.message : describeError(e).message);
    }
  }

  const left = status.data
    ? `${status.data.remaining} of ${status.data.limit} AI requests left today`
    : null;

  let action: ReactNode;
  if (waitingToSync) {
    action = <Text color="textMuted">AI feedback is available once this workout has synced.</Text>;
  } else if (!online) {
    action = (
      <View style={{ gap: theme.spacing.xs }}>
        <Button title="Get AI feedback" disabled fullWidth />
        <Text variant="caption" color="textMuted">
          Needs connection.
        </Text>
      </View>
    );
  } else if (status.data && !status.data.enabled) {
    action = <Text color="textMuted">AI features are switched off right now.</Text>;
  } else if (status.data?.paused_for_budget) {
    action = (
      <Text color="textMuted">
        AI is paused for today because the daily spending limit was reached. It’s back tomorrow.
      </Text>
    );
  } else {
    action = (
      <View style={{ gap: theme.spacing.xs }}>
        <Button
          title={feedback ? 'Get new feedback' : 'Get AI feedback'}
          variant={feedback ? 'secondary' : 'primary'}
          onPress={() => ask(!!feedback)}
          loading={request.isPending}
          disabled={status.data?.remaining === 0}
          fullWidth
        />
        <Text variant="caption" color="textMuted">
          {request.isPending
            ? 'Asking Claude… usually under 10 seconds.'
            : status.data?.remaining === 0
              ? `You’ve used your ${status.data.limit} AI requests for today. You get new ones tomorrow.`
              : left}
        </Text>
      </View>
    );
  }

  const c = feedback?.content;
  return (
    <Card>
      <Text variant="heading">AI feedback</Text>
      {c ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text>{c.summary}</Text>
          {c.see_professional ? <SeeProfessional /> : null}
          <FeedbackList title="What went well" items={c.positives} color="success" />
          <FeedbackList title="Watch out" items={c.warnings} color="danger" />
          <FeedbackList title="Next time" items={c.suggestions} />
          {stale ? (
            <>
              <Text variant="caption" color="textMuted">
                You edited this workout after this feedback was written.
              </Text>
              {action}
            </>
          ) : null}
        </View>
      ) : (
        action
      )}
      {message ? (
        <Text color="danger" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
