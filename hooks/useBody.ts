import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deleteMeasurement, fetchMeasurements, saveMeasurement } from '@/lib/api/body';
import { useUserId } from '@/stores/authStore';

import { profileKey } from './useProfile';

export function useMeasurements() {
  return useQuery({ queryKey: ['body'], queryFn: fetchMeasurements });
}

/** Saving or deleting also refreshes the profile, whose bodyweight the server updates. */
function useInvalidate() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['body'] });
    queryClient.invalidateQueries({ queryKey: profileKey(userId) });
  };
}

export function useSaveMeasurement() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: saveMeasurement, onSuccess: invalidate });
}

export function useDeleteMeasurement() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: deleteMeasurement, onSuccess: invalidate });
}
