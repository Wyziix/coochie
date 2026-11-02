import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { onNotificationTap, registerPush } from '@/lib/platform/push';

/** Keeps this device's web push subscription on the signed-in user; opens tapped notifications. */
export function AiWatcher() {
  useEffect(() => {
    registerPush().catch(() => {});
    return onNotificationTap((url) => router.push(url as Href));
  }, []);
  return null;
}
