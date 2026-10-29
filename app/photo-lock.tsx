import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';

import { NewSecretFields, SecretInput } from '@/components/photos/SecretFields';
import { InfoRow } from '@/components/profile/InfoRow';
import { Button, Card, ErrorState, LoadingState, Text } from '@/components/ui';
import { useForgotPhotoLock } from '@/hooks/useForgotPhotoLock';
import { useBiometrics, useLockStatus } from '@/hooks/usePhotoLock';
import { useTheme } from '@/hooks/useTheme';
import {
  changeLockSecret,
  refusedMessage,
  relockPhotos,
  removeLock,
  setupLock,
  unlockPhotos,
  validateSecret,
  type LockKind,
} from '@/lib/api/photoLock';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { clearLocalBiometrics, disableBiometrics, enableBiometrics } from '@/lib/photos/biometrics';

type Mode = 'menu' | 'set' | 'change' | 'remove' | 'biometrics';

const STATE_LABELS = { setup: 'Not set up', pin: 'PIN', password: 'Password', none: 'Off' };

/** Profile → Photo lock: set, change or remove the PIN/password, biometrics (Android). */
export default function PhotoLockScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const status = useLockStatus();
  const biometrics = useBiometrics();
  const forgotLock = useForgotPhotoLock();
  const [mode, setMode] = useState<Mode>('menu');
  const [current, setCurrent] = useState('');
  const [kind, setKind] = useState<LockKind>('pin');
  const [secret, setSecret] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status.isPending) return <LoadingState />;
  if (status.error) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const lock = status.data;
  const currentKind: LockKind | null =
    lock.state === 'pin' || lock.state === 'password' ? lock.state : null;
  const what = currentKind === 'password' ? 'password' : 'PIN';

  function open(next: Mode) {
    setMode(next);
    setCurrent('');
    setSecret('');
    setRepeat('');
    setKind('pin');
    setError(null);
    setDone(null);
  }

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      const message = await action();
      if (message === null) return;
      await queryClient.invalidateQueries({ queryKey: ['photo-lock'] });
      open('menu');
      setDone(message);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  /** Shows the message and keeps the form open. */
  const fail = (message: string) => {
    setError(message);
    setCurrent('');
    return null;
  };

  const checkNew = () => {
    const invalid = validateSecret(kind, secret);
    if (invalid) return invalid;
    if (secret !== repeat) return kind === 'pin' ? 'PINs don’t match.' : 'Passwords don’t match.';
    return null;
  };

  const set = () =>
    run(async () => {
      const invalid = checkNew();
      if (invalid) return fail(invalid);
      const { token } = await setupLock(kind, secret);
      await relockPhotos(token).catch(() => {}); // set up here, not opened
      return kind === 'pin' ? 'PIN set.' : 'Password set.';
    });

  const change = () =>
    run(async () => {
      const invalid = checkNew();
      if (invalid) return fail(invalid);
      const result = await changeLockSecret(current, kind, secret);
      if (!result.ok) return fail(refusedMessage(result, currentKind));
      return kind === 'pin' ? 'PIN changed.' : 'Password changed.';
    });

  const remove = () =>
    run(async () => {
      const ok = await confirm({
        title: 'Remove the photo lock?',
        message: 'Anyone signed in to your account on this device could open your photos.',
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return null;
      const result = await removeLock(current);
      if (!result.ok) return fail(refusedMessage(result, currentKind));
      await clearLocalBiometrics();
      return 'Photo lock removed.';
    });

  const turnOnBiometrics = () =>
    run(async () => {
      const result = await unlockPhotos({ secret: current });
      if (!result.ok) return fail(refusedMessage(result, currentKind));
      try {
        await enableBiometrics(result.token);
      } finally {
        await relockPhotos(result.token).catch(() => {});
      }
      return 'Biometric unlock is on for this phone.';
    });

  const turnOffBiometrics = () =>
    run(async () => {
      await disableBiometrics();
      return 'Biometric unlock is off.';
    });

  const forgot = () =>
    run(async () => {
      const result = await forgotLock(currentKind);
      return result === 'done' ? 'Lock reset. Set a new PIN or password.' : null;
    });

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <InfoRow label="Photo lock" value={STATE_LABELS[lock.state]} />
        <InfoRow label="Photos" value={String(lock.photo_count)} />
        {biometrics.data?.supported && currentKind ? (
          <InfoRow label="Fingerprint / face" value={biometrics.data.enabled ? 'On' : 'Off'} />
        ) : null}
      </Card>
      <Text variant="caption" color="textMuted">
        The PIN or password is checked on the server and stored only as a hash. After 5 wrong tries
        it locks for 15 minutes.
        {Platform.OS === 'web' ? ' Fingerprint / face unlock is only in the Android app.' : ''}
      </Text>
      {done ? (
        <Text color="success" accessibilityLiveRegion="polite">
          {done}
        </Text>
      ) : null}

      {mode === 'menu' ? (
        <View style={{ gap: theme.spacing.sm }}>
          {currentKind ? (
            <>
              <Button
                title="Change PIN or password"
                variant="secondary"
                onPress={() => open('change')}
              />
              {biometrics.data?.supported ? (
                biometrics.data.enabled ? (
                  <Button
                    title="Turn off fingerprint / face unlock"
                    variant="secondary"
                    onPress={turnOffBiometrics}
                    loading={busy}
                  />
                ) : (
                  <Button
                    title="Turn on fingerprint / face unlock"
                    variant="secondary"
                    onPress={() => open('biometrics')}
                  />
                )
              ) : null}
              <Button title="Remove photo lock" variant="ghost" onPress={() => open('remove')} />
              <Button title={`Forgot ${what}?`} variant="ghost" onPress={forgot} disabled={busy} />
            </>
          ) : (
            <Button title="Set a PIN or password" onPress={() => open('set')} />
          )}
          {error ? <Text color="danger">{error}</Text> : null}
        </View>
      ) : (
        <Card>
          <Text variant="heading">
            {mode === 'set'
              ? 'Set a PIN or password'
              : mode === 'change'
                ? 'Change PIN or password'
                : mode === 'remove'
                  ? 'Remove photo lock'
                  : 'Turn on fingerprint / face unlock'}
          </Text>
          {mode !== 'set' && currentKind ? (
            <SecretInput
              kind={currentKind}
              label={`Current ${what}`}
              value={current}
              onChangeText={setCurrent}
              autoFocus
            />
          ) : null}
          {mode === 'set' || mode === 'change' ? (
            <NewSecretFields
              kind={kind}
              onKindChange={setKind}
              secret={secret}
              onSecretChange={setSecret}
              repeat={repeat}
              onRepeatChange={setRepeat}
            />
          ) : null}
          {error ? (
            <Text color="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            title={mode === 'remove' ? 'Remove lock' : mode === 'biometrics' ? 'Turn on' : 'Save'}
            variant={mode === 'remove' ? 'danger' : 'primary'}
            loading={busy}
            disabled={mode !== 'set' && !current}
            onPress={
              mode === 'set'
                ? set
                : mode === 'change'
                  ? change
                  : mode === 'remove'
                    ? remove
                    : turnOnBiometrics
            }
          />
          <Button title="Cancel" variant="ghost" onPress={() => open('menu')} disabled={busy} />
        </Card>
      )}
    </ScrollView>
  );
}
