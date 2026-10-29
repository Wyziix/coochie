import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { onNotificationTap, registerPush } from '@/lib/platform/push';

/** Android: registers for weekly-report pushes and opens the report on tap. */
export function AiWatcher() {
  useEffect(() => {
    registerPush().catch(() => {});
    return onNotificationTap((url) => router.push(url as Href));
  }, []);
  return null;
}
