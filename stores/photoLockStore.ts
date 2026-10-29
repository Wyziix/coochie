import { create } from 'zustand';

import { relockPhotos } from '@/lib/api/photoLock';

type PhotoLockState = {
  /** Unlock token from the server. Memory only: never persisted. */
  token: string | null;
  expiresAt: number | null;
  /** The camera / photo picker is open: going to the background then doesn't re-lock. */
  pickerOpen: boolean;
  /** Shown on the lock screen, e.g. why a PIN reset didn't go through. */
  notice: string | null;
  setUnlocked: (token: string, expiresAt: string) => void;
  setPickerOpen: (open: boolean) => void;
};

export const usePhotoLockStore = create<PhotoLockState>()((set) => ({
  token: null,
  expiresAt: null,
  pickerOpen: false,
  notice: null,
  setUnlocked: (token, expiresAt) => set({ token, expiresAt: Date.parse(expiresAt), notice: null }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),
}));

/** Forget the token here and end the session on the server too. */
export function lockPhotos() {
  const { token } = usePhotoLockStore.getState();
  if (!token) return;
  usePhotoLockStore.setState({ token: null, expiresAt: null, pickerOpen: false });
  relockPhotos(token).catch(() => {});
}

/** /photos and /photos/compare; not /photo-lock (settings). */
export function isPhotosPath(pathname: string) {
  return pathname === '/photos' || pathname.startsWith('/photos/');
}
