import { Card, ErrorState, LoadingState, OptionList, Text } from '@/components/ui';
import { usePrivacySettings, useSavePrivacy } from '@/hooks/useSocial';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

import { Toggle } from './Toggle';

/** Who sees my activity and whether PRs show the weight. */
export function SharingCard() {
  const online = useIsOnline();
  const privacy = usePrivacySettings();
  const save = useSavePrivacy();
  if (privacy.isPending) return <LoadingState />;
  if (!privacy.data) return <ErrorState error={privacy.error} onRetry={() => privacy.refetch()} />;
  const p = privacy.data;
  return (
    <Card>
      <Text variant="heading">Who sees my activity</Text>
      <OptionList
        options={[
          {
            value: 'friends',
            label: 'Friends',
            description: 'Finished workouts, PRs, badges, level-ups, challenge wins',
          },
          {
            value: 'nobody',
            label: 'Nobody',
            description: 'Your friends see nothing in their feed',
          },
        ]}
        value={p.activity_visibility}
        onChange={(v) =>
          online && save.mutate({ ...p, activity_visibility: v as 'friends' | 'nobody' })
        }
        accessibilityLabel="Who sees my activity"
      />
      <Toggle
        label="Show the weight on my PRs"
        note="Off: friends see “New PR on Bench Press” without the number."
        value={p.pr_show_weight}
        disabled={!online}
        onChange={(v) => save.mutate({ ...p, pr_show_weight: v })}
      />
      <Text variant="caption" color="textMuted">
        Never shared: bodyweight, photos, nutrition, AI feedback and coach chats.
      </Text>
      {save.error ? <Text color="danger">{describeError(save.error).message}</Text> : null}
    </Card>
  );
}
