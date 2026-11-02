import { Switch, View } from 'react-native';

import { Text } from '@/components/ui';
import { useSaveProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import type { Profile } from '@/lib/api/profiles';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

/** "Hide me from public leaderboards" (Profile → Privacy). */
export function HideFromBoards({ profile }: { profile: Profile }) {
  const theme = useTheme();
  const save = useSaveProfile();
  const online = useIsOnline();
  const value = save.isPending ? !!save.variables?.leaderboard_hidden : profile.leaderboard_hidden;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text>Hide me from public leaderboards</Text>
          <Text variant="caption" color="textMuted">
            You still earn points and see your own rank.
          </Text>
        </View>
        <Switch
          value={value}
          onValueChange={(v) => save.mutate({ leaderboard_hidden: v })}
          disabled={!online || save.isPending}
          accessibilityLabel="Hide me from public leaderboards"
          aria-checked={value}
          trackColor={{ true: theme.colors.primary, false: theme.colors.surfaceAlt }}
        />
      </View>
      {!online ? (
        <Text variant="caption" color="textMuted">
          Needs a connection to change.
        </Text>
      ) : null}
      {save.error ? <Text color="danger">{describeError(save.error).message}</Text> : null}
    </View>
  );
}
