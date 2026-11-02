import { Card, ErrorState, LoadingState, Text } from '@/components/ui';
import { useNotificationSettings, useSaveNotificationSettings } from '@/hooks/useSocial';
import type { NotificationSettings } from '@/lib/api/social';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

import { PushSetting } from './PushSetting';
import { Toggle } from './Toggle';

const types: { key: keyof NotificationSettings; label: string; note?: string }[] = [
  { key: 'friend_request', label: 'Friend requests' },
  { key: 'friend_accepted', label: 'Request accepted' },
  { key: 'pr_beaten', label: 'A friend beat my best lift' },
  { key: 'challenge_invite', label: 'Challenge invites' },
  { key: 'challenge_ending', label: 'Challenge ends in 24 hours' },
  { key: 'streak_risk', label: 'Streak at risk (Sunday evening)' },
  { key: 'weekly_report', label: 'Weekly report is ready' },
  {
    key: 'rest_timer',
    label: 'Rest timer is over',
    note: 'Push only, when the app is in the background.',
  },
];

/** Push on this device plus which notifications I get at all. */
export function NotificationsCard() {
  const online = useIsOnline();
  const settings = useNotificationSettings();
  const save = useSaveNotificationSettings();
  return (
    <Card>
      <Text variant="heading">Notifications</Text>
      <PushSetting />
      {settings.isPending ? (
        <LoadingState />
      ) : !settings.data ? (
        <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        types.map((t) => (
          <Toggle
            key={t.key}
            label={t.label}
            note={t.note}
            value={settings.data[t.key] ?? true}
            disabled={!online}
            onChange={(v) => save.mutate({ ...settings.data, [t.key]: v })}
          />
        ))
      )}
      <Text variant="caption" color="textMuted">
        Everything also shows in the inbox (Social → Inbox), with or without push.
      </Text>
      {save.error ? <Text color="danger">{describeError(save.error).message}</Text> : null}
    </Card>
  );
}
