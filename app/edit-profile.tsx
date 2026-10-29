import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { MeasurementInput } from '@/components/profile/MeasurementInput';
import { UsernameField } from '@/components/profile/UsernameField';
import { Avatar, Button, Card, Input, OptionList, SegmentedControl, Text } from '@/components/ui';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import { useProfile, useSaveProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import { useUsernameCheck } from '@/hooks/useUsernameCheck';
import { UsernameTakenError } from '@/lib/api/profiles';
import {
  changeUnits,
  draftFromProfile,
  draftToUpdate,
  validateDraft,
  type DraftErrors,
  type ProfileDraft,
} from '@/lib/profile/draft';
import {
  experienceOptions,
  goalOptions,
  trainingDayOptions,
  unitOptions,
} from '@/lib/profile/options';
import { heightUnitFor } from '@/lib/units';

export default function EditProfileScreen() {
  const theme = useTheme();
  const { data: profile } = useProfile();
  const save = useSaveProfile();
  const avatar = useAvatarUpload();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const usernameStatus = useUsernameCheck(draft.username, profile?.username);

  const update = (patch: Partial<ProfileDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch)) delete next[key as keyof DraftErrors];
      return next;
    });
  };

  async function onSave() {
    setFormError(null);
    const found = validateDraft(draft);
    if (usernameStatus.state === 'taken') found.username = usernameStatus.message;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await save.mutateAsync(draftToUpdate(draft));
      router.back();
    } catch (e) {
      if (e instanceof UsernameTakenError) setErrors({ username: e.message });
      else setFormError('Couldn’t save. Check your connection and try again.');
    }
  }

  if (!profile) return null;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.center, { gap: theme.spacing.sm }]}>
          <Avatar uri={profile.avatar_url} name={draft.displayName || draft.username} size={96} />
          <Button
            title="Change photo"
            variant="ghost"
            loading={avatar.isPending}
            onPress={() => avatar.mutate()}
          />
          {avatar.isError ? (
            <Text variant="caption" color="danger">
              Upload failed. Try a smaller photo.
            </Text>
          ) : null}
        </View>

        <Card>
          <Input
            label="Display name"
            value={draft.displayName}
            onChangeText={(displayName) => update({ displayName })}
            maxLength={50}
            error={errors.displayName}
          />
          <UsernameField
            value={draft.username}
            onChange={(username) => update({ username })}
            status={usernameStatus}
            error={errors.username}
          />
        </Card>

        <Card>
          <Text variant="label" color="textMuted">
            Units
          </Text>
          <SegmentedControl
            accessibilityLabel="Units"
            options={unitOptions}
            value={draft.units}
            onChange={(units) => setDraft((d) => changeUnits(d, units))}
          />
          <MeasurementInput
            label="Bodyweight"
            unit={draft.units}
            value={draft.bodyweight}
            onChange={(bodyweight) => update({ bodyweight })}
            error={errors.bodyweight}
          />
          <MeasurementInput
            label="Height"
            unit={heightUnitFor(draft.units)}
            value={draft.height}
            onChange={(height) => update({ height })}
            placeholder="Optional"
            error={errors.height}
          />
        </Card>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Goal</Text>
          <OptionList
            accessibilityLabel="Goal"
            options={goalOptions}
            value={draft.goal}
            onChange={(goal) => update({ goal })}
          />
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Experience</Text>
          <OptionList
            accessibilityLabel="Experience"
            options={experienceOptions}
            value={draft.experienceLevel}
            onChange={(experienceLevel) => update({ experienceLevel })}
          />
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Training days per week</Text>
          <SegmentedControl
            accessibilityLabel="Training days per week"
            options={trainingDayOptions}
            value={draft.trainingDays ? String(draft.trainingDays) : ''}
            onChange={(v) => update({ trainingDays: Number(v) })}
          />
        </View>

        {formError ? <Text color="danger">{formError}</Text> : null}
        <Button title="Save" onPress={onSave} loading={save.isPending} fullWidth />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center' },
});
