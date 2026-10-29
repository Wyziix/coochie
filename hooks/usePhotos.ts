import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';

import {
  deletePhoto,
  fetchPhotos,
  PhotosLockedError,
  uploadPhoto,
  type Pose,
} from '@/lib/api/photos';
import { compressPhoto } from '@/lib/images/compress';
import { lockPhotos, usePhotoLockStore } from '@/stores/photoLockStore';

/** The server refused the token (expired, re-locked elsewhere): show the lock again. */
async function lockedGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PhotosLockedError) lockPhotos();
    throw error;
  }
}

/** Own photos while unlocked. Keyed by the token, so nothing is reused after re-locking. */
export function usePhotos() {
  const token = usePhotoLockStore((s) => s.token);
  return useQuery({
    queryKey: ['photos', token],
    queryFn: () => lockedGuard(() => fetchPhotos(token!)),
    enabled: token !== null,
    // Signed URLs live as long as the unlock (max 5 minutes); re-lock clears them.
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Pick (library) or take (camera) a photo, compress it, upload it.
 * On the web, both open the browser's file picker; on iPhone that sheet
 * offers "Take Photo" and "Photo Library". Resolves false if cancelled.
 */
export function useAddPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      source,
      takenOn,
      pose,
    }: {
      source: 'camera' | 'library';
      takenOn: string;
      pose: Pose;
    }) => {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted)
          throw new Error(
            'Camera permission is off. Allow it in settings, or pick from the library.',
          );
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 1,
        exif: false,
      };
      // The picker sends the app to the background on Android (and may hide
      // the page on iPhone): that must not count as leaving the photos.
      const { setPickerOpen } = usePhotoLockStore.getState();
      setPickerOpen(true);
      let result: ImagePicker.ImagePickerResult;
      try {
        result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync(options);
      } finally {
        setPickerOpen(false);
      }
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return false;
      const image = await compressPhoto(asset);
      const token = usePhotoLockStore.getState().token;
      if (!token) throw new PhotosLockedError();
      await lockedGuard(() => uploadPhoto(token, image, { takenOn, pose }));
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['photo-lock'] });
    },
  });
}

export function useDeletePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (photo: { id: string }) => {
      const token = usePhotoLockStore.getState().token;
      if (!token) throw new PhotosLockedError();
      await lockedGuard(() => deletePhoto(token, photo));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['photo-lock'] });
    },
  });
}
