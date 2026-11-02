import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { BottomSheet, Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { installState, promptInstall, subscribeInstall } from '@/lib/platform/install';

type Icon = ComponentProps<typeof Ionicons>['name'];

const iosSteps: { icon: Icon; text: string }[] = [
  {
    icon: 'share-outline',
    text: 'Tap the Share button (the square with an arrow, at the bottom in Safari).',
  },
  { icon: 'add-circle-outline', text: 'Scroll down and tap “Add to Home Screen”.' },
  {
    icon: 'checkmark-circle-outline',
    text: 'Tap “Add”, then open LightweightBaby from your Home Screen.',
  },
];
const androidSteps: { icon: Icon; text: string }[] = [
  { icon: 'ellipsis-vertical', text: 'Open the browser menu (⋮ at the top right in Chrome).' },
  { icon: 'download-outline', text: 'Tap “Install app” or “Add to Home screen”.' },
  {
    icon: 'checkmark-circle-outline',
    text: 'Confirm, then open LightweightBaby from your Home screen.',
  },
];

const DISMISSED = 'lwb:install-dismissed';
const wasDismissed = () => {
  try {
    return globalThis.localStorage?.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
};

/**
 * "Install app": the browser's prompt on Android/desktop, a short guide on
 * iPhone. Hidden once installed. On Home it can be put away ("Not now").
 */
export function InstallCard({ dismissible = false }: { dismissible?: boolean }) {
  const theme = useTheme();
  const state = useSyncExternalStore(subscribeInstall, installState, installState);
  const [guide, setGuide] = useState(false);
  const [dismissed, setDismissed] = useState(() => dismissible && wasDismissed());

  if (state === 'installed' || state === 'unavailable' || dismissed) return null;
  const compact = dismissible;

  function dismiss() {
    setDismissed(true);
    try {
      globalThis.localStorage?.setItem(DISMISSED, '1');
    } catch {
      // storage blocked: it shows again next time
    }
  }
  const steps = state === 'ios' ? iosSteps : androidSteps;

  function onInstall() {
    if (state === 'prompt') void promptInstall();
    else setGuide(true);
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Ionicons name="phone-portrait-outline" size={28} color={theme.colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label">Install the app</Text>
          {compact ? null : (
            <Text variant="caption" color="textMuted">
              Opens full screen from your Home Screen, works offline and can send notifications.
            </Text>
          )}
        </View>
      </View>
      <Button title="Install app" onPress={onInstall} />
      {dismissible ? <Button title="Not now" variant="ghost" onPress={dismiss} /> : null}
      <BottomSheet
        visible={guide}
        onClose={() => setGuide(false)}
        title={state === 'ios' ? 'Add to Home Screen' : 'Install the app'}
      >
        <View style={{ gap: theme.spacing.md }}>
          {steps.map((s, i) => (
            <View
              key={s.icon}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.surfaceAlt,
                }}
              >
                <Ionicons name={s.icon} size={22} color={theme.colors.primary} />
              </View>
              <Text style={{ flex: 1 }}>
                {i + 1}. {s.text}
              </Text>
            </View>
          ))}
          {state === 'ios' ? (
            <Text variant="caption" color="textMuted">
              In Chrome or another browser on iPhone, the Share button is in the address bar. Sign
              in again inside the installed app: it keeps its own data, separate from the browser.
            </Text>
          ) : null}
          <Button title="Got it" variant="secondary" onPress={() => setGuide(false)} />
        </View>
      </BottomSheet>
    </Card>
  );
}
