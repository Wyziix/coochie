import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { describeError } from '@/lib/errors';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/platform/push';

const notes: Record<PushState, string> = {
  on: 'Push notifications are on for this device.',
  off: 'Get notifications on this device even when the app is closed.',
  denied:
    'Notifications are blocked for this app. Allow them in your browser or phone settings, then come back.',
  needs_install:
    'On iPhone, notifications work in the installed app: add it to your Home Screen first, then turn them on there.',
  unsupported: 'This browser can’t show push notifications. You still get everything in the inbox.',
};

/** Web push on this device. The permission prompt only appears after the tap. */
export function PushSetting() {
  const theme = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    pushState()
      .then((s) => live && setState(s))
      .catch(() => live && setState('unsupported'));
    return () => {
      live = false;
    };
  }, []);

  function turnOn() {
    setError(null);
    setBusy(true);
    // Called straight from the tap, so the browser shows its prompt.
    enablePush()
      .then(setState)
      .catch(setError)
      .finally(() => setBusy(false));
  }

  function turnOff() {
    setBusy(true);
    disablePush()
      .then(() => setState('off'))
      .catch(setError)
      .finally(() => setBusy(false));
  }

  if (!state) return null;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label">Push notifications</Text>
      <Text variant="caption" color="textMuted">
        {notes[state]}
      </Text>
      {state === 'off' ? (
        <Button
          title="Turn on push notifications"
          variant="secondary"
          loading={busy}
          onPress={turnOn}
        />
      ) : null}
      {state === 'on' ? (
        <Button title="Turn off on this device" variant="ghost" loading={busy} onPress={turnOff} />
      ) : null}
      {error ? <Text color="danger">{describeError(error).message}</Text> : null}
    </View>
  );
}
