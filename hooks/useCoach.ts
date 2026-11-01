import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import {
  clearCoachChat,
  fetchCoachMessages,
  sendCoachMessage,
  type CoachMessage,
} from '@/lib/api/ai';
import { flushPersistedQueries } from '@/lib/offline/cache';
import { useUserId } from '@/stores/authStore';

/** Coach chat: saved messages (readable offline), plus the reply streaming in. */
export function useCoachChat() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const key = ['coach', userId] as const;
  const messages = useQuery({
    queryKey: key,
    queryFn: fetchCoachMessages,
    enabled: !!userId,
    // Online: always the server's copy (another device may have chatted).
    // Offline: the saved copy, so old messages stay readable.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [pending, setPending] = useState<{ question: string; reply: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const send = useCallback(
    async (question: string): Promise<boolean> => {
      setError(null);
      setPending({ question, reply: '' });
      try {
        const saved = await sendCoachMessage(question, (reply) =>
          setPending((p) => (p ? { ...p, reply } : p)),
        );
        queryClient.setQueryData<CoachMessage[]>(['coach', userId], (old) => [
          ...(old ?? []).filter((m) => !saved.some((s) => s.id === m.id)),
          ...saved,
        ]);
        // Write the offline copy now (it's otherwise saved a moment later).
        flushPersistedQueries().catch(() => {});
        return true;
      } catch (e) {
        setError(e);
        return false;
      } finally {
        setPending(null);
        queryClient.invalidateQueries({ queryKey: ['ai-status'] });
      }
    },
    [queryClient, userId],
  );

  const clear = useMutation({
    mutationFn: () => clearCoachChat(userId!),
    onSuccess: () => {
      queryClient.setQueryData<CoachMessage[]>(['coach', userId], []);
      flushPersistedQueries().catch(() => {});
    },
  });

  return { messages, key, pending, error, send, clear, clearError: () => setError(null) };
}
