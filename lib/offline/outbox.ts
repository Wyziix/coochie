import { create } from 'zustand';

import { newId } from '@/lib/id';

import { offlineStorage } from './storage';

/**
 * Changes waiting to be sent to the server, oldest first. Each user has their
 * own queue (stored under their id), so nothing can sync into another account.
 * Items are sent through the same server functions as online saves, so totals,
 * PRs and points are always calculated on the server.
 */
export type OutboxKind =
  | 'save_workout'
  | 'delete_workout'
  | 'save_template'
  | 'delete_template'
  | 'save_exercise'
  | 'save_rest';

export type OutboxItem = {
  id: string;
  userId: string;
  kind: OutboxKind;
  /** The workout / template / exercise this changes. */
  entityId: string;
  payload: unknown;
  /** Shown in the sync list, e.g. "Workout “Push”". */
  label: string;
  /** When the change was made on this device (last write wins on the server). */
  changedAt: string;
  attempts: number;
  /** failed = the server refused it for good; shown to the user, not retried by itself. */
  status: 'pending' | 'failed';
  error?: string;
};

export type NewOutboxItem = Pick<OutboxItem, 'kind' | 'entityId' | 'payload' | 'label'>;

type OutboxState = {
  userId: string | null;
  items: OutboxItem[];
  loaded: boolean;
  /** Ids being sent right now (not merged with newer changes). */
  sending: string[];
};

export const useOutboxStore = create<OutboxState>()(() => ({
  userId: null,
  items: [],
  loaded: false,
  sending: [],
}));

const keyFor = (userId: string) => `outbox:${userId}`;

// Writes go one after another so an older snapshot never overwrites a newer one.
let writing: Promise<void> = Promise.resolve();
function persist(userId: string, items: OutboxItem[]) {
  const json = JSON.stringify(items);
  writing = writing.then(() => offlineStorage.setItem(keyFor(userId), json)).catch(() => {});
  return writing;
}

/** Loads the signed-in user's queue (call on sign-in; null on sign-out). */
export async function loadOutbox(userId: string | null): Promise<void> {
  if (useOutboxStore.getState().userId === userId && useOutboxStore.getState().loaded) return;
  useOutboxStore.setState({ userId, items: [], loaded: false, sending: [] });
  if (!userId) return;
  let items: OutboxItem[] = [];
  try {
    const raw = await offlineStorage.getItem(keyFor(userId));
    items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    items = [];
  }
  if (useOutboxStore.getState().userId !== userId) return; // switched meanwhile
  useOutboxStore.setState({ items: items.filter((i) => i.userId === userId), loaded: true });
}

function setItems(update: (items: OutboxItem[]) => OutboxItem[]) {
  const { userId, items } = useOutboxStore.getState();
  if (!userId) throw new Error('Not signed in');
  const next = update(items);
  useOutboxStore.setState({ items: next });
  return persist(userId, next);
}

const saveKindFor: Partial<Record<OutboxKind, OutboxKind>> = {
  delete_workout: 'save_workout',
  delete_template: 'save_template',
};

/**
 * Adds a change. A newer save of the same thing replaces a waiting one; a
 * delete drops waiting saves of it. Resolves once it's stored on the device.
 */
export function enqueue(change: NewOutboxItem, changedAt = new Date().toISOString()) {
  const { userId, sending } = useOutboxStore.getState();
  if (!userId) throw new Error('Not signed in');
  return setItems((items) => {
    const waiting = (i: OutboxItem) => i.entityId === change.entityId && !sending.includes(i.id);
    const replaced = items.find((i) => waiting(i) && i.kind === change.kind);
    if (replaced) {
      return items.map((i) =>
        i === replaced
          ? {
              ...i,
              payload: change.payload,
              label: change.label,
              changedAt,
              attempts: 0,
              status: 'pending',
              error: undefined,
            }
          : i,
      );
    }
    const dropKind = saveKindFor[change.kind];
    const kept = dropKind ? items.filter((i) => !(waiting(i) && i.kind === dropKind)) : items;
    return [
      ...kept,
      { ...change, id: newId(), userId, changedAt, attempts: 0, status: 'pending' as const },
    ];
  });
}

export const removeOutboxItems = (ids: string[]) =>
  setItems((items) => items.filter((i) => !ids.includes(i.id)));

export const updateOutboxItem = (id: string, patch: Partial<OutboxItem>) =>
  setItems((items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

export function hasPendingChange(entityId: string) {
  return useOutboxStore.getState().items.some((i) => i.entityId === entityId);
}

/** For the indicator and the logout warning. */
export function outboxCounts(items: OutboxItem[]) {
  const failed = items.filter((i) => i.status === 'failed').length;
  return { waiting: items.length - failed, failed };
}

export const useOutboxCounts = () => {
  const items = useOutboxStore((s) => s.items);
  return outboxCounts(items);
};
