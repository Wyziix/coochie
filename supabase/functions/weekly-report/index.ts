// Deploy: npm run deploy:functions. Called by pg_cron (see the Stage 6
// migration) and by the admin "Generate now" button.
import { claude, isAdmin, rpc, userIdFromAuth } from '../_shared/clients.ts';
import { handle } from './handler.ts';

Deno.serve((req) => handle(req, { userIdFromAuth, isAdmin, rpc, claude }));
