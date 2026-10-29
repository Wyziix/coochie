import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, ErrorState, LoadingState, Text } from '@/components/ui';
import { NeedsConnection } from '@/components/offline/NeedsConnection';
import { useNow } from '@/hooks/useNow';
import { useForgotPhotoLock } from '@/hooks/useForgotPhotoLock';
import { useBiometrics, useLockStatus } from '@/hooks/usePhotoLock';
import { useTheme } from '@/hooks/useTheme';
import {
  refusedMessage,
  setupLock,
  unlockPhotos,
  validateSecret,
  type LockKind,
  type LockStatus,
  type UnlockResult,
} from '@/lib/api/photoLock';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { biometricsLabel, clearLocalBiometrics, readDeviceKey } from '@/lib/photos/biometrics';
import { usePhotoLockStore } from '@/stores/photoLockStore';

import { NewSecretFields, SecretInput } from './SecretFields';

/**
 * Shows its children only while the photos are unlocked. The PIN is checked
 * on the server, which hands out a 5-minute token; without it the photos
 * Edge Function won't list, sign or upload anything.
 */
export function PhotoGate({ children }: { children: ReactNode }) {
  const token = usePhotoLockStore((s) => s.token);
  const status = useLockStatus();
  const online = useIsOnline();

  if (token) return <>{children}</>;
  if (!online)
    return (
      <NeedsConnection message="Progress photos stay behind your PIN on the server, so they need a connection." />
    );
  if (status.isPending) return <LoadingState />;
  if (status.error) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  if (status.data.state === 'setup') return <SetupLock />;
  if (status.data.state === 'none') return <OpenWithoutLock />;
  return <UnlockPhotos status={status.data} kind={status.data.state} />;
}

function useUnlocked() {
  const queryClient = useQueryClient();
  return (result: UnlockResult) => {
    if (!result.ok) return false;
    usePhotoLockStore.getState().setUnlocked(result.token, result.expires_at);
    queryClient.invalidateQueries({ queryKey: ['photo-lock'] });
    return true;
  };
}

function Panel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.panel, { padding: theme.spacing.lg, gap: theme.spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

function LockIcon() {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <Ionicons name="lock-closed" size={44} color={theme.colors.textMuted} />
    </View>
  );
}

function SetupLock() {
  const onUnlocked = useUnlocked();
  const [kind, setKind] = useState<LockKind>('pin');
  const [secret, setSecret] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const invalid = validateSecret(kind, secret);
    if (invalid) return setError(invalid);
    if (secret !== repeat)
      return setError(kind === 'pin' ? 'PINs don’t match.' : 'Passwords don’t match.');
    setSaving(true);
    setError(null);
    try {
      onUnlocked(await setupLock(kind, secret));
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <LockIcon />
      <Text variant="heading" style={styles.centerText}>
        Lock your progress photos
      </Text>
      <Text color="textMuted" style={styles.centerText}>
        Choose a PIN or a password. It’s checked on the server and never saved on this device. You
        can change or remove it later in Profile → Photo lock.
      </Text>
      <NewSecretFields
        kind={kind}
        onKindChange={setKind}
        secret={secret}
        onSecretChange={setSecret}
        repeat={repeat}
        onRepeatChange={setRepeat}
        error={error ?? undefined}
        onSubmit={save}
      />
      <Button title="Save and open photos" onPress={save} loading={saving} fullWidth />
    </Panel>
  );
}

function OpenWithoutLock() {
  const onUnlocked = useUnlocked();
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    unlockPhotos({})
      .then((r) => !cancelled && onUnlocked(r))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  return <LoadingState />;
}

function UnlockPhotos({ status, kind }: { status: LockStatus; kind: LockKind }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const onUnlocked = useUnlocked();
  const forgotLock = useForgotPhotoLock();
  const biometrics = useBiometrics();
  const notice = usePhotoLockStore((s) => s.notice);
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(status.locked_until);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('fingerprint');
  const now = useNow(1000, lockedUntil !== null);
  const lockedOut = lockedUntil !== null && Date.parse(lockedUntil) > now;
  const what = kind === 'pin' ? 'PIN' : 'password';

  async function submit(input: { secret: string } | { deviceKey: string }) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await unlockPhotos(input);
      if (onUnlocked(result) || result.ok) return;
      if (result.reason === 'locked') {
        setLockedUntil(result.locked_until); // the countdown says the rest
      } else if ('deviceKey' in input && result.reason === 'wrong') {
        // The server no longer knows this phone (lock reset elsewhere).
        await clearLocalBiometrics();
        queryClient.invalidateQueries({ queryKey: ['photo-lock', 'biometrics'] });
        setMessage(`Biometric unlock was turned off. Use your ${what}.`);
      } else {
        setMessage(refusedMessage(result, kind));
      }
      setSecret('');
    } catch (e) {
      setMessage(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function withBiometrics() {
    const key = await readDeviceKey();
    if (key) await submit({ deviceKey: key });
  }

  useEffect(() => {
    if (!biometrics.data?.enabled) return;
    biometricsLabel().then(setLabel);
    if (lockedOut) return;
    readDeviceKey().then((key) => {
      if (key) submit({ deviceKey: key });
    });
    // Prompt once when the lock screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometrics.data?.enabled]);

  async function forgot() {
    setBusy(true);
    setMessage(null);
    try {
      await forgotLock(kind);
    } catch (e) {
      setMessage(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <LockIcon />
      <Text variant="heading" style={styles.centerText}>
        Photos are locked
      </Text>
      <Text color="textMuted" style={styles.centerText}>
        {status.photo_count} photo{status.photo_count === 1 ? '' : 's'}. Enter your {what} to see
        them.
      </Text>
      {lockedOut ? (
        <Text color="danger" style={styles.centerText} accessibilityLiveRegion="polite">
          Too many wrong attempts. Try again in{' '}
          {Math.max(1, Math.ceil((Date.parse(lockedUntil!) - now) / 60_000))} min.
        </Text>
      ) : (
        <>
          <SecretInput
            kind={kind}
            label={kind === 'pin' ? 'PIN' : 'Password'}
            value={secret}
            onChangeText={setSecret}
            onSubmitEditing={() => secret && submit({ secret })}
            autoFocus={!biometrics.data?.enabled}
          />
          <Button
            title="Unlock"
            onPress={() => submit({ secret })}
            loading={busy}
            disabled={!secret}
            fullWidth
          />
          {biometrics.data?.enabled ? (
            <Button
              title={`Use ${label}`}
              variant="secondary"
              onPress={withBiometrics}
              disabled={busy}
              fullWidth
            />
          ) : null}
        </>
      )}
      {message || notice ? (
        <Text color="danger" style={styles.centerText} accessibilityLiveRegion="polite">
          {message ?? notice}
        </Text>
      ) : null}
      <Button title={`Forgot ${what}?`} variant="ghost" onPress={forgot} disabled={busy} />
      <Text
        variant="caption"
        color="textMuted"
        style={{ textAlign: 'center', marginTop: theme.spacing.sm }}
      >
        Stays unlocked for 5 minutes, until you leave the photos or the app goes to the background.
      </Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { flexGrow: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
});
