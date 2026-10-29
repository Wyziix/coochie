import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';

import { saveProfile, uploadAvatar } from '@/lib/api/profiles';
import { useUserId } from '@/stores/authStore';

import { profileKey } from './useProfile';

/** Pick a photo, upload it, and point the profile at it. Resolves false if cancelled. */
export function useAvatarUpload() {
  const userId = useUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return false;

      const url = await uploadAvatar(userId, asset);
      const profile = await saveProfile(userId, { avatar_url: url });
      queryClient.setQueryData(profileKey(userId), profile);
      return true;
    },
  });
}
