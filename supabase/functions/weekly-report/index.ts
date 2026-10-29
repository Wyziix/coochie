// Deploy: npm run deploy:functions. Called by pg_cron (see the Stage 6
// migration) and by the admin "Generate now" button.
import { claude, isAdmin, rpc, service, userIdFromAuth } from '../_shared/clients.ts';
import { sendExpoPush } from '../_shared/push.ts';
import { handle } from './handler.ts';

Deno.serve((req) =>
  handle(req, {
    userIdFromAuth,
    isAdmin,
    rpc,
    claude,
    async pushTokens(userId) {
      const { data } = await service.from('push_tokens').select('token').eq('user_id', userId);
      return (data ?? []).map((r) => r.token as string);
    },
    sendPush: sendExpoPush,
    async deletePushTokens(tokens) {
      await service.from('push_tokens').delete().in('token', tokens);
    },
  }),
);
