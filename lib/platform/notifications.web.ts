// Web (incl. the iPhone home-screen app): no background local notifications.
// The rest timer falls back to an in-app sound + vibration (see restAlert.web.ts).
export const supportsLocalNotifications = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  return false;
}

export async function scheduleRestNotification(): Promise<string | null> {
  return null;
}

export async function cancelRestNotification(): Promise<void> {}
