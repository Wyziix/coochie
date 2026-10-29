import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui';
import { useIsOnline } from '@/lib/offline/network';

/** For features that only work online (photos, admin): a clear state instead of an error. */
export function NeedsConnection({ message }: { message?: string }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Needs connection"
      message={message ?? 'This works only online. Everything else in the gym works offline.'}
    />
  );
}

export function OnlineOnly({ children, message }: { children: ReactNode; message?: string }) {
  const online = useIsOnline();
  return online ? <>{children}</> : <NeedsConnection message={message} />;
}
