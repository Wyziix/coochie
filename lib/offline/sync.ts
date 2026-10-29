import { onlineManager, type QueryClient } from '@tanstack/react-query';

import { saveRestSetting, upsertCustomExercise, type ExerciseInput } from '@/lib/api/exercises';
import { deleteTemplateAt, saveTemplate, type TemplatePayload } from '@/lib/api/templates';
import { deleteWorkoutAt, saveWorkout, type SavePayload } from '@/lib/api/workouts';
import { describeError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

import { flushPersistedQueries } from './cache';

import {
  removeOutboxItems,
  updateOutboxItem,
  useOutboxStore,
  type OutboxItem,
  type OutboxKind,
} from './outbox';

/** Unknown errors get a few tries before they're shown as a problem. */
const MAX_ATTEMPTS = 5;

let queryClient: QueryClient | null = null;
export const setSyncQueryClient = (client: QueryClient | null) => {
  queryClient = client;
};

/** Sends one queued change through the normal server function. */
async function send(item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case 'save_workout': {
      const p = item.payload as SavePayload;
      await saveWorkout({ ...p, p_workout: { ...p.p_workout, client_updated_at: item.changedAt } });
      return;
    }
    case 'delete_workout':
      return deleteWorkoutAt(item.entityId, item.changedAt);
    case 'save_template': {
      const p = item.payload as TemplatePayload;
      await saveTemplate(item.entityId, {
        ...p,
        p_template: { ...(p.p_template as object), client_updated_at: item.changedAt },
      });
      return;
    }
    case 'delete_template':
      return deleteTemplateAt(item.entityId, item.changedAt);
    case 'save_exercise':
      await upsertCustomExercise(item.userId, item.entityId, item.payload as ExerciseInput);
      return;
    case 'save_rest':
      return saveRestSetting(item.entityId, (item.payload as { seconds: number }).seconds);
  }
}

/**
 * Should we try again later (no connection, session needs a refresh, server
 * hiccup) or is this refused for good (validation, deleted exercise, not
 * allowed)? Permanent failures are shown to the user instead of retried.
 */
export function isRetryable(error: unknown): boolean {
  const { kind } = describeError(error);
  const e = (error ?? {}) as { code?: unknown; status?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : null;
  if (kind === 'offline' || kind === 'session') return true;
  if (status !== null && (status >= 500 || status === 408 || status === 429)) return true;
  // PostgREST / Postgres said no: the data itself is the problem.
  if (/^[0-9A-Z]{5}$/.test(code) || /^PGRST/.test(code)) return false;
  return true;
}

const invalidates: Record<OutboxKind, string[][]> = {
  save_workout: [['workouts'], ['last-sets'], ['recent-exercises']],
  delete_workout: [['workouts'], ['last-sets'], ['recent-exercises']],
  save_template: [['templates']],
  delete_template: [['templates']],
  save_exercise: [['exercises']],
  save_rest: [['rest-settings']],
};

export type SyncResult = { sent: number; failed: number; left: number };

let running: Promise<SyncResult> | null = null;

/** Sends everything waiting, in order. Safe to call often; runs once at a time. */
export function syncNow(): Promise<SyncResult> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, failed: 0, left: 0 };
  const { userId, loaded } = useOutboxStore.getState();
  if (!userId || !loaded) return result;

  // Only ever send a user's changes with that user's own session.
  const session = (await getSupabase().auth.getSession()).data.session;
  if (session?.user.id !== userId) {
    result.left = useOutboxStore.getState().items.length;
    return result;
  }

  const done: OutboxItem[] = [];
  for (const item of [...useOutboxStore.getState().items]) {
    if (item.status === 'failed' || item.userId !== userId) continue;
    if (!onlineManager.isOnline() || useOutboxStore.getState().userId !== userId) break;
    useOutboxStore.setState((s) => ({ sending: [...s.sending, item.id] }));
    try {
      await send(item);
      done.push(item);
    } catch (error) {
      const attempts = item.attempts + 1;
      if (!isRetryable(error) || attempts >= MAX_ATTEMPTS) {
        await updateOutboxItem(item.id, {
          status: 'failed',
          attempts,
          error: describeError(error).message,
        });
        result.failed++;
        continue;
      }
      await updateOutboxItem(item.id, { attempts });
      break; // offline or server trouble: keep the order, try again later
    } finally {
      useOutboxStore.setState((s) => ({ sending: s.sending.filter((id) => id !== item.id) }));
    }
  }

  if (done.length > 0) {
    // Refetch first (also lists not on screen) and save the cache, so neither
    // the screen nor the copy kept for offline ever lacks the synced items
    // once they leave the queue.
    const keys = new Map(done.flatMap((i) => invalidates[i.kind]).map((k) => [k.join('/'), k]));
    const refetch = Promise.all(
      [...keys.values()].map((queryKey) =>
        queryClient?.invalidateQueries({ queryKey, refetchType: 'all' }),
      ),
    ).catch(() => {});
    // Never let a slow refetch hold synced items in the queue.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([refetch, new Promise((resolve) => (timer = setTimeout(resolve, 10_000)))]);
    clearTimeout(timer);
    await flushPersistedQueries();
    await removeOutboxItems(done.map((i) => i.id));
  }
  result.sent = done.length;
  result.left = useOutboxStore.getState().items.length;
  return result;
}

/** "Retry" on a failed item: back to waiting, then send. */
export async function retryOutboxItem(id: string) {
  await updateOutboxItem(id, { status: 'pending', attempts: 0, error: undefined });
  return syncNow();
}
