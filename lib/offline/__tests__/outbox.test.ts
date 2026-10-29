import {
  enqueue,
  loadOutbox,
  outboxCounts,
  removeOutboxItems,
  useOutboxStore,
} from '@/lib/offline/outbox';

const memory: Map<string, string> = jest.requireMock('@/lib/offline/storage').__memory;

beforeEach(() => {
  memory.clear();
  useOutboxStore.setState({ userId: null, items: [], loaded: false, sending: [] });
});

const save = (id: string, name: string) => ({
  kind: 'save_workout' as const,
  entityId: id,
  payload: { name },
  label: name,
});

describe('outbox', () => {
  it('is stored on the device by the time enqueue resolves', async () => {
    await loadOutbox('user-a');
    await enqueue(save('w1', 'Push'));
    const stored = JSON.parse(memory.get('outbox:user-a')!);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      userId: 'user-a',
      kind: 'save_workout',
      entityId: 'w1',
      status: 'pending',
    });
  });

  it('keeps one waiting save per workout (the newest)', async () => {
    await loadOutbox('user-a');
    await enqueue(save('w1', 'Push'), '2026-10-29T10:00:00Z');
    await enqueue(save('w1', 'Push edited'), '2026-10-29T10:05:00Z');
    const items = useOutboxStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      payload: { name: 'Push edited' },
      changedAt: '2026-10-29T10:05:00Z',
    });
  });

  it('a delete replaces a waiting save of the same workout', async () => {
    await loadOutbox('user-a');
    await enqueue(save('w1', 'Push'));
    await enqueue(save('w2', 'Pull'));
    await enqueue({ kind: 'delete_workout', entityId: 'w1', payload: null, label: 'Delete' });
    expect(useOutboxStore.getState().items.map((i) => [i.kind, i.entityId])).toEqual([
      ['save_workout', 'w2'],
      ['delete_workout', 'w1'],
    ]);
  });

  it('does not merge into an item that is being sent right now', async () => {
    await loadOutbox('user-a');
    await enqueue(save('w1', 'Push'));
    useOutboxStore.setState({ sending: [useOutboxStore.getState().items[0]!.id] });
    await enqueue(save('w1', 'Push edited'));
    expect(useOutboxStore.getState().items).toHaveLength(2);
  });

  it('keeps each account’s queue separate', async () => {
    await loadOutbox('user-a');
    await enqueue(save('w1', 'A’s workout'));
    await loadOutbox('user-b');
    expect(useOutboxStore.getState().items).toEqual([]);
    await enqueue(save('w2', 'B’s workout'));
    await loadOutbox('user-a');
    expect(useOutboxStore.getState().items.map((i) => i.label)).toEqual(['A’s workout']);
    expect(JSON.parse(memory.get('outbox:user-b')!)[0].userId).toBe('user-b');
  });

  it('ignores items of another user even if they end up in the wrong place', async () => {
    memory.set(
      'outbox:user-a',
      JSON.stringify([
        {
          id: 'x',
          userId: 'user-b',
          kind: 'save_workout',
          entityId: 'w',
          payload: null,
          label: 'x',
          changedAt: '',
          attempts: 0,
          status: 'pending',
        },
      ]),
    );
    await loadOutbox('user-a');
    expect(useOutboxStore.getState().items).toEqual([]);
  });

  it('cannot queue while signed out', async () => {
    await loadOutbox(null);
    expect(() => enqueue(save('w1', 'Push'))).toThrow('Not signed in');
  });

  it('counts waiting and failed items', async () => {
    await loadOutbox('user-a');
    await enqueue(save('w1', 'Push'));
    await enqueue(save('w2', 'Pull'));
    useOutboxStore.setState((s) => ({
      items: s.items.map((i, n) => (n === 0 ? { ...i, status: 'failed' } : i)),
    }));
    expect(outboxCounts(useOutboxStore.getState().items)).toEqual({ waiting: 1, failed: 1 });
    await removeOutboxItems([useOutboxStore.getState().items[0]!.id]);
    expect(useOutboxStore.getState().items).toHaveLength(1);
  });
});
