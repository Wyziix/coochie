// Deploy: npm run deploy:functions. Optional secret OFF_CONTACT (an email or
// URL) goes into the User-Agent Open Food Facts asks for.
import { rpc, userIdFromAuth } from '../_shared/clients.ts';
import { handle } from './handler.ts';

Deno.serve((req) =>
  handle(req, {
    userIdFromAuth,
    rpc,
    fetch: (url, init) => fetch(url, init),
    contact: Deno.env.get('OFF_CONTACT'),
  }),
);
