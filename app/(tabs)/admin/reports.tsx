import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { describeFeedItem } from '@/components/social/FeedItemCard';
import { UserRow } from '@/components/social/UserRow';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { useReports, useResolveReport } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { AdminReport, FeedItem } from '@/lib/api/social';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';

type Status = 'open' | 'dismissed' | 'actioned';
const statuses: { value: Status; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'actioned', label: 'Acted on' },
  { value: 'dismissed', label: 'Dismissed' },
];
const reasonLabels: Record<AdminReport['reason'], string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  cheating: 'Fake workouts',
  inappropriate: 'Inappropriate',
  other: 'Other',
};

/** Admin → Reports: dismiss, hide from leaderboards, or ban. Logged. */
export default function AdminReportsScreen() {
  const theme = useTheme();
  const [status, setStatus] = useState<Status>('open');
  const reports = useReports(status);
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <SegmentedControl
        options={statuses}
        value={status}
        onChange={setStatus}
        accessibilityLabel="Status"
      />
      {reports.isPending ? (
        <LoadingState />
      ) : reports.error ? (
        <ErrorState error={reports.error} onRetry={() => reports.refetch()} />
      ) : reports.data.length === 0 ? (
        <EmptyState icon="flag-outline" title={status === 'open' ? 'No open reports' : 'None'} />
      ) : (
        reports.data.map((r) => <ReportCard key={r.id} report={r} />)
      )}
    </ScrollView>
  );
}

function ReportCard({ report: r }: { report: AdminReport }) {
  const theme = useTheme();
  const resolve = useResolveReport();
  async function act(action: 'dismiss' | 'hide_from_leaderboards' | 'ban') {
    if (action !== 'dismiss') {
      const ok = await confirm({
        title:
          action === 'ban'
            ? `Ban ${r.reported.username}?`
            : `Hide ${r.reported.username} from leaderboards?`,
        message:
          action === 'ban'
            ? 'They disappear from leaderboards, search, feeds and challenges, and can’t use social features.'
            : 'They no longer appear on leaderboards.',
        confirmLabel: action === 'ban' ? 'Ban' : 'Hide',
        destructive: true,
      });
      if (!ok) return;
    }
    resolve.mutate({ id: r.id, action });
  }
  return (
    <Card>
      <UserRow
        user={r.reported}
        note={`${r.reported.email} · ${r.reported.reports} report${r.reported.reports === 1 ? '' : 's'}${r.reported.banned ? ' · banned' : r.reported.leaderboard_banned ? ' · off leaderboards' : ''}`}
      />
      <Text variant="label">
        {reasonLabels[r.reason]} · by {r.reporter ?? 'deleted user'} ·{' '}
        {new Date(r.created_at).toLocaleString()}
      </Text>
      {r.note ? <Text>“{r.note}”</Text> : null}
      {r.activity ? (
        <Text variant="caption" color="textMuted">
          About:{' '}
          {describeFeedItem(
            {
              ...r.activity,
              id: '',
              is_mine: false,
              user: r.reported,
              reactions: {},
              my_reaction: null,
            } as FeedItem,
            'kg',
          )}
        </Text>
      ) : null}
      {r.status === 'open' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          <Button
            title="Dismiss"
            variant="secondary"
            onPress={() => act('dismiss')}
            disabled={resolve.isPending}
            accessibilityLabel={`Dismiss report on ${r.reported.username}`}
          />
          <Button
            title="Hide from leaderboards"
            variant="secondary"
            onPress={() => act('hide_from_leaderboards')}
            disabled={resolve.isPending}
          />
          <Button
            title="Ban"
            variant="danger"
            onPress={() => act('ban')}
            disabled={resolve.isPending}
            accessibilityLabel={`Ban ${r.reported.username}`}
          />
        </View>
      ) : (
        <Text variant="caption" color="textMuted">
          {r.resolution} · {r.resolved_at ? new Date(r.resolved_at).toLocaleString() : ''}
        </Text>
      )}
      {resolve.error ? <Text color="danger">{describeError(resolve.error).message}</Text> : null}
    </Card>
  );
}
