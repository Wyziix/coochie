// Deploy: npm run deploy:functions. Needs the ANTHROPIC_API_KEY function secret.
import { claude, rpc, service, userIdFromAuth } from '../_shared/clients.ts';
import { handle } from './handler.ts';

Deno.serve((req) =>
  handle(req, {
    userIdFromAuth,
    rpc,
    claude,
    async existing(userId, workoutId) {
      const [{ data: feedback }, { data: workout }] = await Promise.all([
        service
          .from('ai_feedback')
          .select('id, content, created_at, source_updated_at')
          .eq('user_id', userId)
          .eq('kind', 'workout')
          .eq('workout_id', workoutId)
          .maybeSingle(),
        service
          .from('workouts')
          .select('updated_at')
          .eq('id', workoutId)
          .eq('user_id', userId)
          .maybeSingle(),
      ]);
      return { feedback: feedback ?? null, workoutUpdatedAt: workout?.updated_at ?? null };
    },
  }),
);
