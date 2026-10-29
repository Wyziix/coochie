import { useQuery } from '@tanstack/react-query';

import { fetchLockStatus } from '@/lib/api/photoLock';
import { biometricsSupported, isBiometricsEnabled } from '@/lib/photos/biometrics';
import { useUserId } from '@/stores/authStore';

/** Lock state, lockout and photo count (no photos themselves). */
export function useLockStatus() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['photo-lock', 'status', userId],
    queryFn: fetchLockStatus,
    enabled: !!userId,
    staleTime: 0,
  });
}

/** Whether this phone can and does unlock with fingerprint / face. Always off on web. */
export function useBiometrics() {
  return useQuery({
    queryKey: ['photo-lock', 'biometrics'],
    queryFn: async () => {
      const supported = await biometricsSupported();
      return { supported, enabled: supported && (await isBiometricsEnabled()) };
    },
    staleTime: Infinity,
  });
}
