import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InfoRow } from '@/components/profile/InfoRow';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar, Button, Card, Header, Screen, Text } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { signOut } from '@/lib/auth';
import { unregisterPush } from '@/lib/platform/push';
import { confirm } from '@/lib/confirm';
import { onlineManager } from '@tanstack/react-query';
import { outboxCounts, useOutboxStore } from '@/lib/offline/outbox';
import { useWorkoutStore } from '@/stores/workoutStore';
import { experienceOptions, goalOptions, labelFor } from '@/lib/profile/options';
import { formatHeight, formatWeight } from '@/lib/units';

export default function ProfileScreen() {
  const theme = useTheme();
  const { data: profile } = useProfile();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    const { waiting, failed } = outboxCounts(useOutboxStore.getState().items);
    const unsynced = waiting + failed;
    const notes = [
      unsynced
        ? `${unsynced} change${unsynced === 1 ? ' hasn’t' : 's haven’t'} synced yet. ${unsynced === 1 ? 'It stays' : 'They stay'} on this device and ${unsynced === 1 ? 'is' : 'are'} sent the next time you sign in with this account, never to another one.`
        : null,
      useWorkoutStore.getState().workout
        ? 'Your workout in progress stays on this device for this account.'
        : null,
      onlineManager.isOnline() ? null : 'You’re offline: signing back in needs a connection.',
    ].filter(Boolean);
    const ok = await confirm({
      title: unsynced ? 'Log out with unsynced changes?' : 'Log out?',
      message: notes.length ? notes.join('\n\n') : undefined,
      confirmLabel: 'Log out',
      destructive: true,
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await unregisterPush();
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  if (!profile) return null;
  const units = profile.units;

  return (
    <Screen scroll header={<Header title="Profile" />}>
      <View style={[styles.identity, { gap: theme.spacing.lg }]}>
        <Avatar uri={profile.avatar_url} name={profile.display_name ?? profile.username} />
        <View style={styles.flex}>
          <Text variant="heading">{profile.display_name || profile.username}</Text>
          <Text color="textMuted">@{profile.username}</Text>
        </View>
      </View>

      <Button
        title="Edit profile"
        variant="secondary"
        onPress={() => router.push('/edit-profile')}
      />

      <Card>
        <Text variant="heading">Training</Text>
        <InfoRow label="Goal" value={labelFor(goalOptions, profile.goal)} />
        <InfoRow label="Experience" value={labelFor(experienceOptions, profile.experience_level)} />
        <InfoRow
          label="Days per week"
          value={profile.training_days_per_week ? String(profile.training_days_per_week) : '–'}
        />
      </Card>

      <Card>
        <Text variant="heading">Body</Text>
        <InfoRow
          label="Bodyweight"
          value={profile.bodyweight_kg != null ? formatWeight(profile.bodyweight_kg, units) : '–'}
        />
        <InfoRow
          label="Height"
          value={profile.height_cm != null ? formatHeight(profile.height_cm, units) : '–'}
        />
        <InfoRow label="Units" value={units} />
      </Card>

      <Card>
        <Text variant="heading">Privacy</Text>
        <Button title="Photo lock" variant="secondary" onPress={() => router.push('/photo-lock')} />
      </Card>

      <Card>
        <Text variant="heading">Appearance</Text>
        <ThemeToggle />
      </Card>

      <Button title="Log out" variant="ghost" onPress={onSignOut} loading={signingOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
});
