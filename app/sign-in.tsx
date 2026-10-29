import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmailSignIn } from '@/components/auth/EmailSignIn';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { signInWithGoogle } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/env';

export default function SignInScreen() {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);

  async function onSignIn() {
    setError(null);
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      // On web the page is about to redirect to Google, so keep the spinner.
      if (result !== 'redirecting') setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Try again.');
      setLoading(false);
    }
  }

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <View style={[styles.hero, { gap: theme.spacing.sm }]}>
        <Text variant="title" accessibilityRole="header" style={styles.center}>
          LightweightBaby
        </Text>
        <Text color="textMuted" style={styles.center}>
          Log your lifts, track progress, train smarter.
        </Text>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        {!isSupabaseConfigured ? (
          <Card>
            <Text variant="label" color="warning">
              Backend not configured
            </Text>
            <Text variant="caption" color="textMuted">
              Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env, then
              restart the dev server.
            </Text>
          </Card>
        ) : null}
        {error ? (
          <Text color="danger" style={styles.center} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button
          title="Continue with Google"
          onPress={onSignIn}
          loading={loading}
          disabled={!isSupabaseConfigured}
          fullWidth
        />
        {showEmail ? (
          <EmailSignIn disabled={!isSupabaseConfigured} />
        ) : (
          <Button
            title="Use email instead"
            variant="ghost"
            onPress={() => setShowEmail(true)}
            disabled={!isSupabaseConfigured}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
});
