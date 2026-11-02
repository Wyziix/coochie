// Deploy: npm run deploy:functions. Called by pg_cron through social_tick().
import { rpc, service } from '../_shared/clients.ts';
import { sendExpoPush } from '../_shared/push.ts';
import { handle } from './handler.ts';

Deno.serve((req) =>
  handle(req, {
    rpc,
    sendPush: (messages) => sendExpoPush(messages, 'social'),
    async deletePushTokens(tokens) {
      await service.from('push_tokens').delete().in('token', tokens);
    },
  }),
);
