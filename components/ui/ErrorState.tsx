import { describeError } from '@/lib/errors';

import { EmptyState } from './EmptyState';
import { Text } from './Text';

export type ErrorStateProps = {
  /** The caught error; its real cause is shown (offline, missing table, permission...). */
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({ error, title, message, onRetry }: ErrorStateProps) {
  const described = error !== undefined ? describeError(error) : null;
  const icon =
    described?.kind === 'offline'
      ? 'cloud-offline-outline'
      : described?.kind === 'permission' || described?.kind === 'session'
        ? 'lock-closed-outline'
        : 'alert-circle-outline';

  return (
    <>
      <EmptyState
        icon={icon}
        title={title ?? described?.title ?? 'Something went wrong'}
        message={message ?? described?.message ?? 'Please try again.'}
        actionLabel={onRetry ? 'Try again' : undefined}
        onAction={onRetry}
      />
      {described?.detail ? (
        <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }} selectable>
          {described.detail}
        </Text>
      ) : null}
    </>
  );
}
