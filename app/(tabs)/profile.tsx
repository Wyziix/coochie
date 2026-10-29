import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InfoRow } from '@/components/profile/InfoRow';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar, Button, Card, Header, Screen, Text } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { signOut } from '@/lib/auth';
import { confirm } from '@/lib/confirm';
import { experienceOptions, goalOptions, labelFor } from '@/lib/profile/options';
import { formatHeight, formatWeight } from '@/lib/units';

export default function ProfileScreen() {
  const theme = useTheme();
  const { data: profile } = useProfile();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    const ok = await confirm({ title: 'Log out?', confirmLabel: 'Log out', destructive: true });
    if (!ok) return;
    setSigningOut(true);
    try {
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
