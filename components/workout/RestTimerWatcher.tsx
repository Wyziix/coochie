import { useEffect } from 'react';

import { restDoneAlert } from '@/lib/platform/feedback';
import { useWorkoutStore } from '@/stores/workoutStore';

/**
 * Mounted once at the root. When the rest timer runs out while the app is
 * open, plays the in-app alert (haptics on native, beep + vibration on web)
 * and clears the timer. If the timer already ended while the app was closed
 * or the page was reloaded, it's cleared quietly: the notification (native)
 * already did the job.
 */
export function RestTimerWatcher() {
  const endsAt = useWorkoutStore((s) => s.restTimer?.endsAt ?? null);

  useEffect(() => {
    if (endsAt === null) return;
    const ms = endsAt - Date.now();
    if (ms <= -5000) {
      useWorkoutStore.getState().clearRest();
      return;
    }
    const id = setTimeout(
      () => {
        if (useWorkoutStore.getState().restTimer?.endsAt !== endsAt) return;
        // JS timers pause in the background; don't alert late on resume.
        if (Date.now() - endsAt < 3000) restDoneAlert();
        useWorkoutStore.getState().clearRest();
      },
      Math.max(0, ms),
    );
    return () => clearTimeout(id);
  }, [endsAt]);

  return null;
}
