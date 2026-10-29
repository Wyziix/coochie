// Progress photos behind the photo lock. Every request needs the user's JWT
// (Authorization) and an unlock token (x-photo-unlock) from photo_unlock().
// The database functions check the token as that user; only after they agree
// does this function sign URLs or touch files with the service key.
//
// Kept free of Deno/npm imports so it can be tested with fakes (handler.test.ts).

export type RpcResult<T = unknown> = {
  data: T | null;
  error: { message: string; code?: string } | null;
  status: number;
};

export type Deps = {
  /** Database calls made as the signed-in user (PostgREST checks the JWT). */
  userDb(authorization: string): {
    rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>>;
  };
  /** The private progress-photos bucket, with the service key. */
  storage: {
    sign(
      paths: string[],
      ttlSeconds: number,
    ): Promise<{ path: string; signedUrl: string | null }[]>;
    upload(path: string, file: Blob): Promise<void>;
    remove(paths: string[]): Promise<void>;
  };
  newId(): string;
  now(): number;
};

type PhotoRow = { id: string; storage_path: string } & Record<string, unknown>;
type Session = { user_id: string; expires_at: string };

export const MAX_BYTES = 10 * 1024 * 1024;
/** Signed URLs never outlive the unlock (5 minutes at most). */
export const MAX_URL_TTL = 300;
const POSES = ['front', 'side', 'back', 'other'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-photo-unlock',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Database errors → HTTP. PT403 is raised by the SQL when the token isn't valid. */
function fromDb(result: RpcResult): Response {
  const code = result.error?.code;
  if (code === 'PT403' || result.status === 403) return json({ error: 'locked' }, 403);
  if (result.status === 401) return json({ error: 'Not signed in' }, 401);
  if (code === 'P0002') return json({ error: 'Photo not found' }, 404);
  return json({ error: result.error?.message ?? 'Database error' }, 400);
}

async function isJpeg(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = req.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization)) return json({ error: 'Not signed in' }, 401);
  const token = req.headers.get('x-photo-unlock') ?? '';
  if (!token) return json({ error: 'locked' }, 403);

  const db = deps.userDb(authorization);

  try {
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      return await upload(req, token, db, deps);
    }
    const body = (await req.json().catch(() => null)) as { action?: string; id?: string } | null;
    switch (body?.action) {
      case 'list':
        return await list(token, db, deps);
      case 'delete':
        return await remove(token, body.id, db, deps);
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (error) {
    return json({ error: `Storage error: ${(error as Error).message}` }, 500);
  }
}

async function list(token: string, db: ReturnType<Deps['userDb']>, deps: Deps) {
  const session = await db.rpc<Session>('photo_session', { p_token: token });
  if (session.error || !session.data) return fromDb(session);
  const rows = await db.rpc<PhotoRow[]>('photo_list', { p_token: token });
  if (rows.error || !rows.data) return fromDb(rows);

  const left = Math.floor((Date.parse(session.data.expires_at) - deps.now()) / 1000);
  const ttl = Math.max(1, Math.min(MAX_URL_TTL, left));
  const signed = rows.data.length
    ? await deps.storage.sign(
        rows.data.map((r) => r.storage_path),
        ttl,
      )
    : [];
  const urls = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return json({
    expires_at: session.data.expires_at,
    photos: rows.data.map((r) => ({ ...r, url: urls.get(r.storage_path) ?? null })),
  });
}

async function upload(req: Request, token: string, db: ReturnType<Deps['userDb']>, deps: Deps) {
  // Check the unlock before reading the body.
  const session = await db.rpc<Session>('photo_session', { p_token: token });
  if (session.error || !session.data) return fromDb(session);

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof Blob)) return json({ error: 'No photo in the request' }, 400);
  if (file.size === 0) return json({ error: 'The photo is empty' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'Photos can be at most 10 MB' }, 413);
  if (!(await isJpeg(file))) return json({ error: 'Photos must be JPEG' }, 415);

  const takenOn = String(form.get('taken_on') ?? '');
  const pose = String(form.get('pose') ?? 'front');
  const width = Number(form.get('width'));
  const height = Number(form.get('height'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) return json({ error: 'Date must be YYYY-MM-DD' }, 400);
  if (!POSES.includes(pose)) return json({ error: 'Unknown pose' }, 400);

  const id = deps.newId();
  const path = `${session.data.user_id}/${id}.jpg`;
  await deps.storage.upload(path, new Blob([file], { type: 'image/jpeg' }));

  const added = await db.rpc<string>('photo_add', {
    p_token: token,
    p_id: id,
    p_taken_on: takenOn,
    p_pose: pose,
    p_width: Number.isInteger(width) && width > 0 ? width : null,
    p_height: Number.isInteger(height) && height > 0 ? height : null,
  });
  if (added.error) {
    // Don't leave an orphaned file behind (e.g. the unlock expired meanwhile).
    await deps.storage.remove([path]);
    return fromDb(added);
  }
  return json({ id, storage_path: added.data }, 201);
}

async function remove(
  token: string,
  id: string | undefined,
  db: ReturnType<Deps['userDb']>,
  deps: Deps,
) {
  if (!id || !UUID.test(id)) return json({ error: 'Photo not found' }, 404);
  const deleted = await db.rpc<string>('photo_delete', { p_token: token, p_id: id });
  if (deleted.error || !deleted.data) return fromDb(deleted);
  await deps.storage.remove([deleted.data]);
  return json({ ok: true });
}
