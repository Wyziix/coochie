import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';

import { deletePhoto, fetchPhotos, uploadPhoto, type Pose } from '@/lib/api/photos';
import { compressPhoto } from '@/lib/images/compress';
import { useUserId } from '@/stores/authStore';

export function usePhotos() {
  // Signed URLs last an hour; refetch well before that.
  return useQuery({ queryKey: ['photos'], queryFn: fetchPhotos, staleTime: 30 * 60_000 });
}

/**
 * Pick (library) or take (camera) a photo, compress it, upload it.
 * On the web, both open the browser's file picker; on iPhone that sheet
 * offers "Take Photo" and "Photo Library". Resolves false if cancelled.
 */
export function useAddPhoto() {
  const userId = useUserId();
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
      if (!userId) throw new Error('Not signed in');
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
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return false;
      const image = await compressPhoto(asset);
      await uploadPhoto(userId, image, { takenOn, pose });
      return true;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['photos'] }),
  });
}

export function useDeletePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['photos'] }),
  });
}
