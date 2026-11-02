import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Card, Input, Text } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from '@/hooks/useTheme';
import {
  deleteAccount,
  RECENT_SIGN_IN_SECONDS,
  signedInSecondsAgo,
} from '@/lib/account/deleteAccount';
import { isValidEmail, sendEmailCode, signInWithGoogle, verifyEmailCode } from '@/lib/auth';
import { setReturnPath } from '@/lib/auth/returnPath';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { useAuthStore } from '@/stores/authStore';

const GONE = [
  'Workouts, sets, templates, programs and personal records',
  'Body stats, progress photos and the photo lock',
  'Nutrition logs, water, your own foods and targets',
  'Points, levels, badges, streaks and challenge entries',
  'Friends, feed items, reactions, reports and notifications',
  'Coach chats, AI feedback and weekly reports',
  'Your profile, avatar and sign-in',
];

/** Delete my account: sign in again (last 10 minutes), type the username, then everything goes. */
export default function DeleteAccountScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const { data: profile } = useProfile();
  const now = useNow(15_000);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');

  const ago = signedInSecondsAgo(session?.access_token, now);
  const recent = ago !== null && ago <= RECENT_SIGN_IN_SECONDS - 30;
  const email = session?.user.email ?? '';
  const username = profile?.username ?? '';
  const matches = typed.trim().toLowerCase() === username.toLowerCase() && username !== '';

  function reauthGoogle() {
    setError(null);
    setReturnPath('/delete-account');
    signInWithGoogle().catch(setError);
  }

  function sendCode() {
    setError(null);
    setBusy(true);
    sendEmailCode(email)
      .then(() => setCodeSent(true))
      .catch(setError)
      .finally(() => setBusy(false));
  }

  function checkCode() {
    setError(null);
    setBusy(true);
    verifyEmailCode(email, code)
      .then(() => {
        setCodeSent(false);
        setCode('');
      })
      .catch(setError)
      .finally(() => setBusy(false));
  }

  async function onDelete() {
    const ok = await confirm({
      title: 'Delete your account for good?',
      message: 'This can’t be undone. Everything listed here is deleted right away.',
      confirmLabel: 'Delete everything',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(typed, queryClient);
      router.replace('/sign-in');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <Text variant="heading">This deletes everything</Text>
        {GONE.map((line) => (
          <Text key={line}>• {line}</Text>
        ))}
        <Text variant="caption" color="textMuted">
          Admin logs keep a record that something happened, without your name. This device is
          cleared too: cached data, unsynced changes, notifications. Export your data first if you
          want a copy (Settings → Your data).
        </Text>
      </Card>

      <Card>
        <Text variant="heading">1. Sign in again</Text>
        {recent ? (
          <Text color="success">
            Signed in {ago! < 60 ? 'just now' : `${Math.round(ago! / 60)} min ago`}. ✓
          </Text>
        ) : (
          <>
            <Text color="textMuted">
              For safety, you need to have signed in within the last 10 minutes.
            </Text>
            <Button title="Sign in again with Google" disabled={!online} onPress={reauthGoogle} />
            {isValidEmail(email) ? (
              codeSent ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <Input
                    label={`Code sent to ${email}`}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                  />
                  <Button
                    title="Confirm code"
                    variant="secondary"
                    loading={busy}
                    disabled={code.trim().length < 6}
                    onPress={checkCode}
                  />
                </View>
              ) : (
                <Button
                  title="Email me a code instead"
                  variant="ghost"
                  disabled={!online}
                  loading={busy}
                  onPress={sendCode}
                />
              )
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <Text variant="heading">2. Type your username</Text>
        <Input
          label={`Type ${username} to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Username to confirm"
        />
      </Card>

      <Button
        title={busy && !codeSent ? 'Deleting…' : 'Delete my account'}
        variant="danger"
        loading={busy && !codeSent}
        disabled={!online || !recent || !matches || busy}
        onPress={() => void onDelete()}
      />
      {!online ? <Text color="textMuted">Deleting needs a connection.</Text> : null}
      {error ? <Text color="danger">{describeError(error).message}</Text> : null}
    </ScrollView>
  );
}
