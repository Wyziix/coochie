import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deletePushToken, savePushToken } from '@/lib/api/ai';

import { ensureNotificationPermission } from './notifications';

// Android app: "Your weekly report is ready" through Expo's push service.
// Needs an EAS build with push credentials (FCM) set up, see docs/SETUP.md.
export const supportsPush = Platform.OS === 'android';

let registered: string | null = null;

/** Registers this phone for the signed-in user, if notifications are allowed. */
export async function registerPush(): Promise<boolean> {
  if (!supportsPush) return false;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return false;
  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return false;
  await Notifications.setNotificationChannelAsync('reports', {
    name: 'Weekly reports',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await savePushToken(data, 'android');
  registered = data;
  return true;
}

/** "Turn on notifications" on the reports screen. */
export async function askForPush(): Promise<boolean> {
  if (!supportsPush) return false;
  if (!(await ensureNotificationPermission())) return false;
  return registerPush();
}

export async function pushAllowed(): Promise<boolean> {
  if (!supportsPush) return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

/** On logout, so the next person on this phone doesn't get your reports. */
export async function unregisterPush(): Promise<void> {
  if (!registered) return;
  await deletePushToken(registered).catch(() => {});
  registered = null;
}

/** Opens the screen a tapped notification points to (also when it started the app). */
export function onNotificationTap(open: (url: string) => void): () => void {
  const handle = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) open(url);
  };
  Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
