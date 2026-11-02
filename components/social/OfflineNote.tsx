import { Text } from '@/components/ui';
import { useIsOnline } from '@/lib/offline/network';
import { timeAgo } from '@/lib/points/format';

/** "Offline, last updated 5 min ago" when showing the saved copy. */
export function OfflineNote({ updatedAt }: { updatedAt: number | undefined }) {
  const online = useIsOnline();
  if (online || !updatedAt) return null;
  return (
    <Text variant="caption" color="textMuted">
      Offline, last updated {timeAgo(updatedAt)}.
    </Text>
  );
}

/** For buttons that need the server (add friend, react...). */
export function NeedsConnectionNote() {
  const online = useIsOnline();
  if (online) return null;
  return (
    <Text variant="caption" color="textMuted">
      Needs connection to change anything here.
    </Text>
  );
}
