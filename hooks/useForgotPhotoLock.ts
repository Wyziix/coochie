import { useQueryClient } from '@tanstack/react-query';

import type { LockKind } from '@/lib/api/photoLock';
import { confirm } from '@/lib/confirm';
import { resetWithGoogle } from '@/lib/photos/reset';
import { usePhotoLockStore } from '@/stores/photoLockStore';

/** Forgot PIN: confirm, sign in with Google again, reset (photos are kept). */
export function useForgotPhotoLock() {
  const queryClient = useQueryClient();
  return async (kind: LockKind | null) => {
    const what = kind === 'password' ? 'password' : 'PIN';
    const ok = await confirm({
      title: `Forgot your ${what}?`,
      message:
        'Sign in with Google again to reset it. Your photos are kept; you’ll choose a new PIN or password. An email code isn’t enough.',
      confirmLabel: 'Sign in with Google',
    });
    if (!ok) return 'cancelled' as const;
    usePhotoLockStore.setState({ notice: null });
    const result = await resetWithGoogle();
    if (result === 'done') {
      await queryClient.invalidateQueries({ queryKey: ['photo-lock'] });
    }
    return result;
  };
}
