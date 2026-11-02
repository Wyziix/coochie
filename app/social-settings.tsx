import { ScrollView, Switch, View } from 'react-native';

import { NeedsConnectionNote } from '@/components/social/OfflineNote';
import { Card, ErrorState, LoadingState, OptionList, Text } from '@/components/ui';
import {
  useNotificationSettings,
  usePrivacySettings,
  useSaveNotificationSettings,
  useSavePrivacy,
} from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { NotificationType } from '@/lib/api/social';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

const types: { key: NotificationType; label: string }[] = [
  { key: 'friend_request', label: 'Friend requests' },
  { key: 'friend_accepted', label: 'Request accepted' },
  { key: 'pr_beaten', label: 'A friend beat my best lift' },
  { key: 'challenge_invite', label: 'Challenge invites' },
  { key: 'challenge_ending', label: 'Challenge ends in 24 hours' },
  { key: 'streak_risk', label: 'Streak at risk (Sunday evening)' },
];

/** Who sees my activity, PR weights, and which notifications I get. */
export default function SocialSettingsScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const privacy = usePrivacySettings();
  const notifications = useNotificationSettings();
  const savePrivacy = useSavePrivacy();
  const saveNotifications = useSaveNotificationSettings();

  if (privacy.isPending || notifications.isPending) return <LoadingState />;
  if (!privacy.data || !notifications.data) {
    return (
      <ErrorState
        error={privacy.error ?? notifications.error}
        onRetry={() => (privacy.refetch(), notifications.refetch())}
      />
    );
  }
  const p = privacy.data;
  const n = notifications.data;
  const error = savePrivacy.error ?? saveNotifications.error;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <NeedsConnectionNote />
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
            online && savePrivacy.mutate({ ...p, activity_visibility: v as 'friends' | 'nobody' })
          }
          accessibilityLabel="Who sees my activity"
        />
        <Toggle
          label="Show the weight on my PRs"
          note="Off: friends see “New PR on Bench Press” without the number."
          value={p.pr_show_weight}
          disabled={!online}
          onChange={(v) => savePrivacy.mutate({ ...p, pr_show_weight: v })}
        />
        <Text variant="caption" color="textMuted">
          Never shared: bodyweight, photos, AI feedback and coach chats.
        </Text>
      </Card>
      <Card>
        <Text variant="heading">Notifications</Text>
        {types.map((t) => (
          <Toggle
            key={t.key}
            label={t.label}
            value={n[t.key]}
            disabled={!online}
            onChange={(v) => saveNotifications.mutate({ ...n, [t.key]: v })}
          />
        ))}
        <Text variant="caption" color="textMuted">
          They show in the inbox (Social → Inbox). On Android also as push notifications once
          they’re turned on.
        </Text>
      </Card>
      {error ? <Text color="danger">{describeError(error).message}</Text> : null}
    </ScrollView>
  );
}

function Toggle({
  label,
  note,
  value,
  disabled,
  onChange,
}: {
  label: string;
  note?: string;
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 44 }}
    >
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {note ? (
          <Text variant="caption" color="textMuted">
            {note}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        aria-checked={value}
        trackColor={{ true: theme.colors.primary, false: theme.colors.surfaceAlt }}
      />
    </View>
  );
}
