// POST { barcode } or { query } with the user's JWT. Looks in our foods
// table first (cached Open Food Facts products and the user's own foods),
// asks Open Food Facts only when needed (proper User-Agent, per-user rate
// limit), and caches what it gets. Testable with a fake fetch.
import { corsHeaders, json } from '../_shared/ai.ts';
import { type OffProduct, productUrl, searchUrl, toFood, userAgent } from './off.ts';

export type Food = Record<string, unknown> & {
  id: string;
  stale?: boolean;
  is_hidden?: boolean;
  owner_id?: string | null;
};

export type Deps = {
  userIdFromAuth(authorization: string): Promise<string | null>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  fetch(url: string, init: { headers: Record<string, string> }): Promise<Response>;
  contact?: string | null;
};

const strip = (f: Food) => {
  const { stale: _s, ...rest } = f;
  return rest;
};

async function limited(deps: Deps, userId: string, action: 'barcode' | 'search') {
  try {
    await deps.rpc('food_rate_check', { p_user: userId, p_action: action });
    return null;
  } catch {
    return json({ error: 'rate_limited', message: 'Too many lookups. Try again in a while.' }, 429);
  }
}

async function off(
  deps: Deps,
  url: string,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  try {
    const res = await deps.fetch(url, {
      headers: { 'User-Agent': userAgent(deps.contact), Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method', message: 'Method not allowed' }, 405);
  const userId = await deps
    .userIdFromAuth(req.headers.get('authorization') ?? '')
    .catch(() => null);
  if (!userId) return json({ error: 'auth', message: 'Sign in again.' }, 401);
  const body = (await req.json().catch(() => null)) as { barcode?: string; query?: string } | null;

  if (body?.barcode !== undefined) {
    const barcode = String(body.barcode).replace(/\s/g, '');
    if (!/^[0-9]{6,14}$/.test(barcode))
      return json({ error: 'bad_request', message: 'That doesn’t look like a barcode.' }, 400);
    const cached = await deps.rpc<Food | null>('food_by_barcode', {
      p_user: userId,
      p_barcode: barcode,
    });
    if (cached?.is_hidden) return json({ found: false, barcode, reason: 'hidden' });
    if (cached && (!cached.stale || cached.owner_id))
      return json({ found: true, food: strip(cached), from: 'cache' });

    const stop = await limited(deps, userId, 'barcode');
    if (stop) return cached ? json({ found: true, food: strip(cached), from: 'cache' }) : stop;
    const res = await off(deps, productUrl(barcode));
    if (!res.ok) {
      if (cached) return json({ found: true, food: strip(cached), from: 'cache' });
      if (res.status === 404) return json({ found: false, barcode });
      return json(
        {
          error: 'off_unavailable',
          message: 'Open Food Facts didn’t answer. Try again, or add the food yourself.',
        },
        502,
      );
    }
    const product = (res.body as { status?: number; product?: OffProduct }).product;
    const food = product ? toFood({ ...product, code: product.code ?? barcode }) : null;
    if (!food)
      return json({ found: false, barcode, reason: product ? 'no_nutrition' : 'not_found' });
    const [saved] = await deps.rpc<Food[]>('food_cache_upsert', { p_foods: [food] });
    if (!saved) return json({ found: false, barcode, reason: 'hidden' });
    return json({ found: true, food: saved, from: 'open_food_facts' });
  }

  const query = String(body?.query ?? '').trim();
  if (query.length < 2)
    return json({ error: 'bad_request', message: 'Type at least 2 letters.' }, 400);
  if (query.length > 80) return json({ error: 'bad_request', message: 'Keep it shorter.' }, 400);
  const local = await deps.rpc<Food[]>('food_search_local', { p_user: userId, p_query: query });
  const stop = await limited(deps, userId, 'search');
  if (stop) return local.length ? json({ foods: local, partial: true }) : stop;
  const res = await off(deps, searchUrl(query));
  if (!res.ok) return json({ foods: local, partial: true });
  const products = ((res.body as { products?: OffProduct[] }).products ?? [])
    .map(toFood)
    .filter((f) => f !== null);
  const saved = products.length
    ? await deps.rpc<Food[]>('food_cache_upsert', { p_foods: products })
    : [];
  const seen = new Set<string>();
  const foods = [...local, ...saved].filter((f) =>
    seen.has(f.id) ? false : (seen.add(f.id), true),
  );
  return json({ foods: foods.slice(0, 30), partial: false });
}
