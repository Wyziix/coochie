import { useState } from 'react';

import { StepLayout } from '@/components/onboarding/StepLayout';
import { MeasurementInput } from '@/components/profile/MeasurementInput';
import { UsernameField } from '@/components/profile/UsernameField';
import { OptionList, SegmentedControl, Text } from '@/components/ui';
import { useProfile, useSaveProfile } from '@/hooks/useProfile';
import { useUsernameCheck } from '@/hooks/useUsernameCheck';
import { UsernameTakenError } from '@/lib/api/profiles';
import { describeError } from '@/lib/errors';
import {
  changeUnits,
  draftFromProfile,
  draftToUpdate,
  validateField,
  type DraftField,
  type ProfileDraft,
} from '@/lib/profile/draft';
import {
  experienceOptions,
  goalOptions,
  trainingDayOptions,
  unitOptions,
} from '@/lib/profile/options';

const steps: { field: DraftField; title: string; subtitle?: string }[] = [
  { field: 'username', title: 'Pick a username', subtitle: 'Friends will find you by this.' },
  { field: 'units', title: 'Units', subtitle: 'You can change this later.' },
  { field: 'goal', title: 'What’s your main goal?' },
  { field: 'experienceLevel', title: 'How experienced are you?' },
  {
    field: 'trainingDays',
    title: 'Training days per week',
    subtitle: 'What you plan, not what’s perfect.',
  },
  {
    field: 'bodyweight',
    title: 'Your bodyweight',
    subtitle: 'Used for progress and nutrition targets.',
  },
];

export default function OnboardingScreen() {
  const { data: profile } = useProfile();
  const save = useSaveProfile();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const usernameStatus = useUsernameCheck(draft.username);

  const step = steps[index]!;
  const isLast = index === steps.length - 1;
  const update = (patch: Partial<ProfileDraft>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const fieldError = validateField(draft, step.field);
  const usernameBlocked =
    step.field === 'username' && !['available', 'error'].includes(usernameStatus.state);

  async function next() {
    if (fieldError) return setError(fieldError);
    if (!isLast) return setIndex((i) => i + 1);
    try {
      await save.mutateAsync({
        ...draftToUpdate(draft),
        onboarding_completed_at: new Date().toISOString(),
      });
      // The root layout sees onboarding_completed_at and switches to the tabs.
    } catch (e) {
      if (e instanceof UsernameTakenError) {
        setIndex(0);
        setError(e.message);
      } else {
        setError(`Couldn’t save: ${describeError(e).message}`);
      }
    }
  }

  return (
    <StepLayout
      step={index + 1}
      total={steps.length}
      title={step.title}
      subtitle={step.subtitle}
      nextLabel={isLast ? 'Finish' : 'Next'}
      nextDisabled={usernameBlocked || (step.field !== 'bodyweight' && !!fieldError)}
      loading={save.isPending}
      error={error}
      onNext={next}
      onBack={index > 0 ? () => setIndex((i) => i - 1) : undefined}
    >
      {step.field === 'username' ? (
        <UsernameField
          value={draft.username}
          onChange={(username) => update({ username })}
          status={usernameStatus}
        />
      ) : null}

      {step.field === 'units' ? (
        <SegmentedControl
          accessibilityLabel="Units"
          options={unitOptions}
          value={draft.units}
          onChange={(units) => setDraft((d) => changeUnits(d, units))}
        />
      ) : null}

      {step.field === 'goal' ? (
        <OptionList
          accessibilityLabel="Goal"
          options={goalOptions}
          value={draft.goal}
          onChange={(goal) => update({ goal })}
        />
      ) : null}

      {step.field === 'experienceLevel' ? (
        <OptionList
          accessibilityLabel="Experience"
          options={experienceOptions}
          value={draft.experienceLevel}
          onChange={(experienceLevel) => update({ experienceLevel })}
        />
      ) : null}

      {step.field === 'trainingDays' ? (
        <SegmentedControl
          accessibilityLabel="Training days per week"
          options={trainingDayOptions}
          value={draft.trainingDays ? String(draft.trainingDays) : ''}
          onChange={(v) => update({ trainingDays: Number(v) })}
        />
      ) : null}

      {step.field === 'bodyweight' ? (
        <>
          <MeasurementInput
            label="Bodyweight"
            unit={draft.units}
            value={draft.bodyweight}
            onChange={(bodyweight) => update({ bodyweight })}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={next}
          />
          <Text variant="caption" color="textMuted">
            Stored privately. Only you can see it.
          </Text>
        </>
      ) : null}
    </StepLayout>
  );
}
