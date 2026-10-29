import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { confirm } from '@/lib/confirm';
import { useIsOnline } from '@/lib/offline/network';
import { removeOutboxItems, useOutboxStore, type OutboxItem } from '@/lib/offline/outbox';
import { retryOutboxItem, syncNow } from '@/lib/offline/sync';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** What's waiting to sync, and changes the server refused (retry or discard). */
export default function SyncScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const items = useOutboxStore((s) => s.items);
  const [busy, setBusy] = useState(false);
  const failed = items.filter((i) => i.status === 'failed');
  const waiting = items.filter((i) => i.status === 'pending');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  async function discard(item: OutboxItem) {
    const ok = await confirm({
      title: 'Discard this change?',
      message: `“${item.label}” will be removed from this device and never sent.`,
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (ok) await removeOutboxItems([item.id]);
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <Text color="textMuted">
        {online
          ? 'Online. Changes are sent automatically.'
          : 'Offline. Changes are kept on this device and sent when you’re back online.'}
      </Text>

      {items.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="All synced"
          message="Nothing is waiting."
        />
      ) : null}

      {failed.length ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Couldn’t sync</Text>
          <Text variant="caption" color="textMuted">
            The server refused these. Retry after fixing the cause, or discard them.
          </Text>
          {failed.map((item) => (
            <Card key={item.id}>
              <Text variant="label">{item.label}</Text>
              <Text variant="caption" color="textMuted">
                {when(item.changedAt)}
              </Text>
              <Text color="danger">{item.error}</Text>
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                <Button
                  title="Retry"
                  variant="secondary"
                  disabled={busy || !online}
                  onPress={() => run(() => retryOutboxItem(item.id))}
                />
                <Button
                  title="Discard"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => discard(item)}
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {waiting.length ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Waiting to sync ({waiting.length})</Text>
          {waiting.map((item) => (
            <Card key={item.id}>
              <Text variant="label">{item.label}</Text>
              <Text variant="caption" color="textMuted">
                {when(item.changedAt)}
                {item.attempts ? ` · tried ${item.attempts}×` : ''}
              </Text>
            </Card>
          ))}
          <Button
            title="Sync now"
            onPress={() => run(syncNow)}
            loading={busy}
            disabled={!online}
            fullWidth
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
});
