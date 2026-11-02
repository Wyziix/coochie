// POST { username } with the user's JWT → deletes the account for good:
// 1. the session must come from a sign-in in the last 10 minutes,
// 2. the typed username must match, 3. the last admin can't go,
// 4. their files in storage (avatars, progress photos) are removed,
// 5. delete_user_data() removes every row that belongs to or names them
//    (admin log entries stay, anonymised), 6. the auth user is deleted.
// Testable with fakes (handler.test.ts).
import { corsHeaders, json } from '../_shared/ai.ts';

export type Deps = {
  /** Verified user and when this session signed in (JWT amr), or null. */
  session(authorization: string): Promise<{ userId: string; signedInAt: Date | null } | null>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  storage: {
    /** Every file path under the folder (recursively). */
    list(bucket: string, folder: string): Promise<string[]>;
    remove(bucket: string, paths: string[]): Promise<void>;
  };
  deleteAuthUser(userId: string): Promise<void>;
  now?(): Date;
};

export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;
export const BUCKETS = ['avatars', 'progress-photos'];

type Account = { username: string | null; role: string; last_admin: boolean } | null;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method', message: 'Method not allowed' }, 405);

  const session = await deps.session(req.headers.get('authorization') ?? '').catch(() => null);
  if (!session) return json({ error: 'auth', message: 'Sign in again.' }, 401);
  const { userId, signedInAt } = session;
  const now = (deps.now?.() ?? new Date()).getTime();
  if (!signedInAt || now - signedInAt.getTime() > RECENT_SIGN_IN_MS) {
    return json(
      {
        error: 'reauth',
        message: 'For safety, sign in again (in the last 10 minutes) before deleting your account.',
      },
      403,
    );
  }

  const body = (await req.json().catch(() => null)) as { username?: unknown } | null;
  const typed = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const account = await deps.rpc<Account>('account_for_delete', { p_user: userId });
  if (!account) return json({ error: 'not_found', message: 'This account is already gone.' }, 404);
  if (!typed || typed !== (account.username ?? '').toLowerCase()) {
    return json({ error: 'confirm', message: 'Type your username exactly to confirm.' }, 400);
  }
  if (account.last_admin) {
    return json(
      { error: 'last_admin', message: 'You are the last admin. Make someone else an admin first.' },
      409,
    );
  }

  try {
    for (const bucket of BUCKETS) {
      const paths = (await deps.storage.list(bucket, userId)).filter((p) =>
        p.startsWith(`${userId}/`),
      );
      for (let i = 0; i < paths.length; i += 100) {
        await deps.storage.remove(bucket, paths.slice(i, i + 100));
      }
    }
    await deps.rpc('delete_user_data', { p_user: userId });
    await deps.deleteAuthUser(userId);
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (/last admin/i.test(message)) {
      return json(
        {
          error: 'last_admin',
          message: 'You are the last admin. Make someone else an admin first.',
        },
        409,
      );
    }
    // Nothing is lost by trying again: each step only removes what's left.
    return json(
      { error: 'delete_failed', message: 'Couldn’t finish deleting. Try again in a minute.' },
      500,
    );
  }
  return json({ deleted: true });
}
