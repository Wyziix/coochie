import { useCallback } from 'react';

import { primeAlertSound } from '@/lib/platform/feedback';
import { cancelRestNotification, scheduleRestNotification } from '@/lib/platform/notifications';
import { useWorkoutStore } from '@/stores/workoutStore';

import { useNow } from './useNow';

/** Start / adjust / skip the rest timer, keeping the scheduled notification in sync. */
export function useRestTimerControls() {
  const start = useCallback(async (exerciseKey: string, seconds: number, exerciseName: string) => {
    const { restTimer, startRest, clearRest } = useWorkoutStore.getState();
    const previous = restTimer?.notificationId ?? null;
    // Update the UI first; notification bookkeeping follows.
    if (seconds <= 0) {
      clearRest();
      return cancelRestNotification(previous);
    }
    primeAlertSound();
    startRest(exerciseKey, seconds, null);
    await cancelRestNotification(previous);
    const id = await scheduleRestNotification(seconds, exerciseName);
    const current = useWorkoutStore.getState().restTimer;
    if (current?.exerciseKey === exerciseKey)
      useWorkoutStore.getState().setRestEnd(current.endsAt, current.totalSeconds, id);
    else await cancelRestNotification(id);
  }, []);

  const adjust = useCallback(async (deltaSeconds: number, exerciseName: string) => {
    const { restTimer, setRestEnd, clearRest } = useWorkoutStore.getState();
    if (!restTimer) return;
    const endsAt = restTimer.endsAt + deltaSeconds * 1000;
    const remaining = Math.round((endsAt - Date.now()) / 1000);
    await cancelRestNotification(restTimer.notificationId);
    if (remaining <= 0) return clearRest();
    setRestEnd(endsAt, Math.max(restTimer.totalSeconds + deltaSeconds, remaining), null);
    const id = await scheduleRestNotification(remaining, exerciseName);
    const current = useWorkoutStore.getState().restTimer;
    if (current) setRestEnd(current.endsAt, current.totalSeconds, id);
    else await cancelRestNotification(id);
  }, []);

  const skip = useCallback(async () => {
    const { restTimer, clearRest } = useWorkoutStore.getState();
    clearRest();
    await cancelRestNotification(restTimer?.notificationId ?? null);
  }, []);

  return { start, adjust, skip };
}

/** Remaining seconds of the running rest timer (null when none). Re-renders 4×/s. */
export function useRestRemaining() {
  const restTimer = useWorkoutStore((s) => s.restTimer);
  const now = useNow(250, restTimer !== null);
  if (!restTimer) return null;
  return {
    remaining: Math.max(0, Math.ceil((restTimer.endsAt - now) / 1000)),
    total: restTimer.totalSeconds,
    exerciseKey: restTimer.exerciseKey,
  };
}
