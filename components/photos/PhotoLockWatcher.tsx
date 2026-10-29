import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { describeError } from '@/lib/errors';
import { finishPendingReset } from '@/lib/photos/reset';
import { useUserId } from '@/stores/authStore';
import { isPhotosPath, lockPhotos, usePhotoLockStore } from '@/stores/photoLockStore';

/**
 * Re-locks the photos when you leave the photos section, when the app goes
 * to the background, after the unlock's 5 minutes, or on sign-out, and drops
 * the photo list (with its signed URLs) from memory. On web it also finishes
 * a "forgot PIN" reset after the Google sign-in redirect.
 */
export function PhotoLockWatcher() {
  const pathname = usePathname();
  const userId = useUserId();
  const token = usePhotoLockStore((s) => s.token);
  const expiresAt = usePhotoLockStore((s) => s.expiresAt);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isPhotosPath(pathname)) lockPhotos();
  }, [pathname]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !usePhotoLockStore.getState().pickerOpen) lockPhotos();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (expiresAt === null) return;
    const id = setTimeout(lockPhotos, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(id);
  }, [expiresAt]);

  useEffect(() => {
    if (!userId) lockPhotos();
  }, [userId]);

  useEffect(() => {
    if (token === null) queryClient.removeQueries({ queryKey: ['photos'] });
  }, [token, queryClient]);

  useEffect(() => {
    if (!userId) return;
    finishPendingReset(userId)
      .then(async (result) => {
        if (result !== 'done') return;
        await queryClient.invalidateQueries({ queryKey: ['photo-lock'] });
        router.push('/photos');
      })
      .catch((error) => {
        usePhotoLockStore.setState({ notice: describeError(error).message });
        router.push('/photos');
      });
  }, [userId, queryClient]);

  return null;
}
