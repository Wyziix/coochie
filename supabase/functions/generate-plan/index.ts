// Deploy: npm run deploy:functions. Needs the ANTHROPIC_API_KEY function secret.
import { claude, rpc, userIdFromAuth } from '../_shared/clients.ts';
import { handle } from './handler.ts';

Deno.serve((req) => handle(req, { userIdFromAuth, rpc, claude }));
