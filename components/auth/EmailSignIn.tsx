import { useState } from 'react';
import { View } from 'react-native';

import { Button, Input, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { isValidEmail, sendEmailCode, verifyEmailCode } from '@/lib/auth';

type Props = { disabled?: boolean };

export function EmailSignIn({ disabled }: Props) {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    run(async () => {
      if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
      await sendEmailCode(email);
      setSentTo(email.trim().toLowerCase());
      setCode('');
    });

  // On success the auth listener picks up the session and the app moves on.
  const verify = () => run(() => verifyEmailCode(sentTo!, code));

  if (!sentTo) {
    return (
      <View style={{ gap: theme.spacing.md }}>
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          placeholder="you@example.com"
          returnKeyType="send"
          onSubmitEditing={send}
          error={error ?? undefined}
        />
        <Button
          title="Email me a sign-in code"
          variant="secondary"
          onPress={send}
          loading={busy}
          disabled={disabled}
          fullWidth
        />
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text color="textMuted">
        We sent a code to {sentTo}. Type it below, or open the link in the email on this device.
      </Text>
      <Input
        label="Sign-in code"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={10}
        placeholder="123456"
        returnKeyType="done"
        onSubmitEditing={verify}
        error={error ?? undefined}
      />
      <Button
        title="Sign in"
        onPress={verify}
        loading={busy}
        disabled={code.length < 6}
        fullWidth
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Button title="Change email" variant="ghost" onPress={() => setSentTo(null)} />
        <Button title="Resend code" variant="ghost" onPress={send} disabled={busy} />
      </View>
    </View>
  );
}
