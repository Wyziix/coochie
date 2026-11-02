import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { HideFromBoards } from '@/components/points/HideFromBoards';
import { InfoRow } from '@/components/profile/InfoRow';
import { DefaultRestCard } from '@/components/settings/DefaultRestCard';
import { ExportPanel } from '@/components/settings/ExportPanel';
import { InstallCard } from '@/components/settings/InstallCard';
import { NotificationsCard } from '@/components/settings/NotificationsCard';
import { SharingCard } from '@/components/settings/SharingCard';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, Card, SegmentedControl, Text } from '@/components/ui';
import { useTargets } from '@/hooks/useNutrition';
import { useLockStatus } from '@/hooks/usePhotoLock';
import { useProfile, useSaveProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import type { WeightUnit } from '@/lib/units';

const lockLabels: Record<string, string> = {
  setup: 'Not set up',
  none: 'Off',
  pin: 'PIN',
  password: 'Password',
};

/** Everything in one place: units, theme, rest, notifications, privacy, photo lock, nutrition, install, export, delete. */
export default function SettingsScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const { data: profile } = useProfile();
  const saveProfile = useSaveProfile();
  const targets = useTargets();
  const lock = useLockStatus();

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <InstallCard />

      <Card>
        <Text variant="heading">Units</Text>
        <SegmentedControl<WeightUnit>
          accessibilityLabel="Units"
          options={[
            { value: 'kg', label: 'kg / cm' },
            { value: 'lbs', label: 'lbs / in' },
          ]}
          value={profile?.units ?? 'kg'}
          onChange={(units) => online && profile?.units !== units && saveProfile.mutate({ units })}
        />
        {saveProfile.error ? (
          <Text color="danger">{describeError(saveProfile.error).message}</Text>
        ) : null}
      </Card>

      <Card>
        <Text variant="heading">Appearance</Text>
        <ThemeToggle />
      </Card>

      <DefaultRestCard />
      <NotificationsCard />

      <SharingCard />
      <Card>
        <Text variant="heading">Leaderboards</Text>
        {profile ? <HideFromBoards profile={profile} /> : null}
      </Card>

      <Card>
        <Text variant="heading">Photo lock</Text>
        <InfoRow
          label="Progress photos"
          value={lock.data ? (lockLabels[lock.data.state] ?? lock.data.state) : '–'}
        />
        <Button
          title="Photo lock settings"
          variant="secondary"
          onPress={() => router.push('/photo-lock')}
        />
      </Card>

      <Card>
        <Text variant="heading">Nutrition targets</Text>
        {targets.data ? (
          <InfoRow
            label="Daily"
            value={`${targets.data.kcal} kcal · P ${targets.data.protein_g} g · C ${targets.data.carbs_g} g · F ${targets.data.fat_g} g`}
          />
        ) : (
          <Text color="textMuted">Not set yet.</Text>
        )}
        <Button
          title="Edit targets"
          variant="secondary"
          onPress={() => router.push('/nutrition/targets')}
        />
      </Card>

      <Card>
        <Text variant="heading">Your data</Text>
        <Text variant="caption" color="textMuted">
          A zip with CSV files (open in Excel or Google Sheets) and one JSON file with everything:
          workouts, sets, templates, PRs, body stats, nutrition, water, points and badges. Progress
          photos are left out unless you unlock them.
        </Text>
        <ExportPanel label="Export my data" />
        <Button
          title="Export with progress photos"
          variant="ghost"
          onPress={() => router.push('/photos/export')}
        />
      </Card>

      <Card>
        <Text variant="heading">Delete account</Text>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted">
            Deletes your account and everything in it for good. Export first if you want a copy.
          </Text>
          <Button
            title="Delete account"
            variant="danger"
            onPress={() => router.push('/delete-account')}
          />
        </View>
      </Card>
    </ScrollView>
  );
}
