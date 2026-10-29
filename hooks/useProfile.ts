import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchProfile, saveProfile, type ProfileUpdate } from '@/lib/api/profiles';
import { useUserId } from '@/stores/authStore';

export const profileKey = (userId: string | null) => ['profile', userId] as const;

export function useProfile() {
  const userId = useUserId();
  return useQuery({
    queryKey: profileKey(userId),
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
  });
}

export function useSaveProfile() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfileUpdate) => {
      if (!userId) throw new Error('Not signed in');
      return saveProfile(userId, patch);
    },
    onSuccess: (profile) => queryClient.setQueryData(profileKey(userId), profile),
  });
}
