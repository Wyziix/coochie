// Deploy: npm run deploy:functions. Needs the ANTHROPIC_API_KEY function secret.
import { claudeStream, rpc, service, userIdFromAuth } from '../_shared/clients.ts';
import { type CoachMessage, handle } from './handler.ts';

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

Deno.serve((req) =>
  handle(req, {
    userIdFromAuth,
    rpc,
    claudeStream,
    waitUntil:
      typeof EdgeRuntime === 'undefined' ? undefined : (work) => EdgeRuntime!.waitUntil(work),
    async history(userId, limit) {
      const { data, error } = await service
        .from('coach_messages')
        .select('role, content')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`coach_messages: ${error.message}`);
      return (data ?? []).reverse() as { role: 'user' | 'assistant'; content: string }[];
    },
    async save(userId, rows) {
      const { data, error } = await service
        .from('coach_messages')
        .insert(rows.map((row) => ({ ...row, user_id: userId })))
        .select('id, role, content, created_at')
        .order('created_at');
      if (error) throw new Error(`coach_messages: ${error.message}`);
      return (data ?? []) as CoachMessage[];
    },
  }),
);
