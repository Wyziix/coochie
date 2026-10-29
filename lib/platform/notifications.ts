import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL = 'rest-timer';
let setUp = false;

async function setUpOnce() {
  if (setUp) return;
  setUp = true;
  // In the foreground the in-app alert handles it; just play the sound.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Rest timer',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      sound: 'default',
    });
  }
}

export const supportsLocalNotifications = true;

/** Asks once; returns whether we may schedule notifications. */
export async function ensureNotificationPermission(): Promise<boolean> {
  await setUpOnce();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Schedules the "rest is over" notification; it fires even with the app in the background. */
export async function scheduleRestNotification(
  seconds: number,
  exerciseName: string,
): Promise<string | null> {
  if (seconds <= 0) return null;
  try {
    if (!(await ensureNotificationPermission())) return null;
    return await Notifications.scheduleNotificationAsync({
      content: { title: 'Rest over', body: `Next set: ${exerciseName}`, sound: 'default' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
        channelId: CHANNEL,
      },
    });
  } catch {
    return null;
  }
}

export async function cancelRestNotification(id: string | null): Promise<void> {
  if (!id) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}
