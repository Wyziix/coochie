import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Text,
} from '@/components/ui';
import { useAdminUsers, useSetUserModeration, useUserLedger } from '@/hooks/usePoints';
import { useSetUserBanned } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { AdminUser } from '@/lib/api/points';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { describeItem, signed } from '@/lib/points/labels';

/** Admin → Users: points, level, ban from leaderboards or hide. Every change is logged. */
export default function AdminUsersScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const users = useAdminUsers(search);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-end' }]}>
        <View style={styles.flex}>
          <Input
            label="Search (name or email)"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            onSubmitEditing={() => setSearch(query)}
          />
        </View>
        <Button title="Search" variant="secondary" onPress={() => setSearch(query)} />
      </View>
      {users.isPending ? (
        <LoadingState />
      ) : users.error ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : users.data.length === 0 ? (
        <EmptyState icon="people-outline" title="No users found" />
      ) : (
        users.data.map((u) => <UserCard key={u.user_id} user={u} />)
      )}
    </ScrollView>
  );
}

function UserCard({ user: u }: { user: AdminUser }) {
  const theme = useTheme();
  const moderate = useSetUserModeration();
  const ban = useSetUserBanned();
  const [showLedger, setShowLedger] = useState(false);
  const ledger = useUserLedger(showLedger ? u.user_id : null);
  const name = u.username ?? u.display_name ?? u.email;

  async function set(change: { leaderboard_banned?: boolean; hidden?: boolean }) {
    const next = { leaderboard_banned: u.leaderboard_banned, hidden: u.hidden, ...change };
    const turningOn = change.leaderboard_banned || change.hidden;
    if (turningOn) {
      const ok = await confirm({
        title: change.hidden ? `Hide ${name}?` : `Ban ${name} from leaderboards?`,
        message: change.hidden
          ? 'They disappear from leaderboards and won’t be findable by others. They can still use the app.'
          : 'They no longer appear on leaderboards. They keep their points and can still use the app.',
        confirmLabel: change.hidden ? 'Hide' : 'Ban',
        destructive: true,
      });
      if (!ok) return;
    }
    moderate.mutate({ userId: u.user_id, ...next });
  }

  return (
    <Card>
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <Avatar uri={u.avatar_url} name={name} size={40} />
        <View style={styles.flex}>
          <Text variant="label">{name}</Text>
          <Text variant="caption" color="textMuted">
            {u.email} · Level {u.level} · {u.points.toLocaleString()} pts
            {u.pending_flags ? ` · ${u.pending_flags} flagged` : ''}
            {u.self_hidden ? ' · hid themselves' : ''}
          </Text>
        </View>
      </View>
      <Toggle
        label="Banned from leaderboards"
        who={name}
        value={u.leaderboard_banned}
        disabled={moderate.isPending}
        onChange={(v) => set({ leaderboard_banned: v })}
      />
      <Toggle
        label="Banned (no social features)"
        who={name}
        value={!!u.banned}
        disabled={ban.isPending}
        onChange={async (v) => {
          if (
            v &&
            !(await confirm({
              title: `Ban ${name}?`,
              message: 'Off leaderboards, search, feeds and challenges; no social actions.',
              confirmLabel: 'Ban',
              destructive: true,
            }))
          )
            return;
          ban.mutate({ userId: u.user_id, banned: v });
        }}
      />
      <Toggle
        label="Hidden"
        who={name}
        value={u.hidden}
        disabled={moderate.isPending}
        onChange={(v) => set({ hidden: v })}
      />
      {u.note ? (
        <Text variant="caption" color="textMuted">
          Note: {u.note}
        </Text>
      ) : null}
      <Button
        title={showLedger ? 'Hide points history' : 'Why these points?'}
        variant="ghost"
        onPress={() => setShowLedger((s) => !s)}
      />
      {showLedger ? (
        ledger.isPending ? (
          <LoadingState />
        ) : ledger.error ? (
          <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} />
        ) : ledger.data.length === 0 ? (
          <Text color="textMuted">No points yet.</Text>
        ) : (
          ledger.data.slice(0, 50).map((r, i) => (
            <View key={i} style={[styles.row, { gap: theme.spacing.sm }]}>
              <Text variant="caption" color="textMuted" style={styles.flex}>
                {r.day} · {describeItem(r)}
                {r.workout ? ` · ${r.workout}` : ''}
              </Text>
              <Text variant="caption">{signed(r.points)}</Text>
            </View>
          ))
        )
      ) : null}
      {moderate.error ? <Text color="danger">{describeError(moderate.error).message}</Text> : null}
    </Card>
  );
}

function Toggle({
  label,
  who,
  value,
  disabled,
  onChange,
}: {
  label: string;
  who: string;
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.spacing.md }]}>
      <Text style={styles.flex}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={`${label}: ${who}`}
        aria-checked={value}
        trackColor={{ true: theme.colors.danger, false: theme.colors.surfaceAlt }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
