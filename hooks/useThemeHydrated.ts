import { useEffect, useState } from 'react';

import { useThemeStore } from '@/stores/themeStore';

// True once the saved theme preference has been read from storage, so the
// splash screen can stay up until then and avoid a light/dark flash.
export function useThemeHydrated() {
  const [hydrated, setHydrated] = useState(() => useThemeStore.persist.hasHydrated());

  useEffect(() => {
    if (hydrated) return;
    const unsub = useThemeStore.persist.onFinishHydration(() => setHydrated(true));
    if (useThemeStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);

  return hydrated;
}
