// deno test supabase/functions. Open Food Facts is faked: no network calls.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

import { type Deps, type Food, handle } from './handler.ts';
import { toFood } from './off.ts';

const USER = 'aaaa0000-0000-0000-0000-000000000001';

const nutella = {
  code: '3017620422003',
  product_name: 'Nutella',
  brands: 'Ferrero, Nutella',
  serving_size: '15 g',
  serving_quantity: 15,
  nutriments: {
    'energy-kcal_100g': 539,
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
  },
};

function setup(
  opts: {
    offProduct?: unknown;
    offStatus?: number;
    offDown?: boolean;
    cached?: Food | null;
    limited?: boolean;
    search?: unknown[];
    local?: Food[];
  } = {},
) {
  const state = {
    fetches: [] as { url: string; headers: Record<string, string> }[],
    upserts: [] as unknown[],
    rates: [] as string[],
  };
  const deps: Deps = {
    // deno-lint-ignore require-await
    async userIdFromAuth(a) {
      return a === 'Bearer user-jwt' ? USER : null;
    },
    // deno-lint-ignore require-await
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      switch (fn) {
        case 'food_by_barcode':
          return (opts.cached ?? null) as T;
        case 'food_search_local':
          return (opts.local ?? []) as T;
        case 'food_rate_check':
          state.rates.push(String(args.p_action));
          if (opts.limited) throw new Error('Too many requests');
          return null as T;
        case 'food_cache_upsert': {
          const foods = args.p_foods as Record<string, unknown>[];
          state.upserts.push(...foods);
          return foods.map((f, i) => ({ id: `food-${i}`, source: 'off', ...f })) as T;
        }
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore require-await
    async fetch(url, init) {
      state.fetches.push({ url, headers: init.headers });
      if (opts.offDown) throw new Error('network');
      if (url.includes('/cgi/search.pl')) {
        return new Response(JSON.stringify({ products: opts.search ?? [] }), { status: 200 });
      }
      if (opts.offStatus && opts.offStatus !== 200)
        return new Response('{}', { status: opts.offStatus });
      return new Response(
        JSON.stringify(
          opts.offProduct === undefined ? { status: 1, product: nutella } : opts.offProduct,
        ),
        { status: 200 },
      );
    },
    contact: 'gym@example.com',
  };
  return { deps, state };
}

const post = (body: unknown, auth = 'Bearer user-jwt') =>
  new Request('http://fn/food-search', {
    method: 'POST',
    headers: { authorization: auth },
    body: JSON.stringify(body),
  });

Deno.test(
  'barcode: asks Open Food Facts with a proper User-Agent, caches the product',
  async () => {
    const { deps, state } = setup();
    const res = await handle(post({ barcode: '3017620422003' }), deps);
    const body = await res.json();
    assertEquals(body.found, true);
    assertEquals(body.from, 'open_food_facts');
    assertEquals(body.food.name, 'Nutella');
    assertEquals(body.food.kcal_100g, 539);
    assertEquals(body.food.serving_g, 15);
    assertEquals(body.food.brand, 'Ferrero');
    assertMatch(
      state.fetches[0]!.url,
      /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017620422003\?fields=/,
    );
    assertEquals(state.fetches[0]!.headers['User-Agent'], 'LightweightBaby/1.0 (gym@example.com)');
    assertEquals(state.rates, ['barcode']);
    assertEquals(state.upserts.length, 1);
  },
);

Deno.test('barcode already cached: answered from our table, no Open Food Facts call', async () => {
  const { deps, state } = setup({ cached: { id: 'f1', name: 'Nutella', stale: false } });
  const body = await (await handle(post({ barcode: '3017620422003' }), deps)).json();
  assertEquals(body, { found: true, food: { id: 'f1', name: 'Nutella' }, from: 'cache' });
  assertEquals(state.fetches.length, 0);
  assertEquals(state.rates.length, 0);
});

Deno.test('my own food with that barcode wins, even if old', async () => {
  const { deps, state } = setup({
    cached: { id: 'mine', name: 'Lasagne', owner_id: USER, stale: true },
  });
  assertEquals(
    (await (await handle(post({ barcode: '2000000000017' }), deps)).json()).food.id,
    'mine',
  );
  assertEquals(state.fetches.length, 0);
});

Deno.test(
  'stale cache is refreshed; if Open Food Facts is down, the cached copy is used',
  async () => {
    const { deps, state } = setup({
      cached: { id: 'f1', name: 'Old', stale: true },
      offDown: true,
    });
    const body = await (await handle(post({ barcode: '3017620422003' }), deps)).json();
    assertEquals(body.food.name, 'Old');
    assertEquals(state.fetches.length, 1);
  },
);

Deno.test('not found, no nutrition, hidden: "create it yourself"', async () => {
  for (const [opts, reason] of [
    [{ offProduct: { status: 0, status_verbose: 'product not found' } }, 'not_found'],
    [{ offStatus: 404 }, undefined],
    [
      {
        offProduct: {
          status: 1,
          product: { code: '3017620422003', product_name: 'Water', nutriments: {} },
        },
      },
      'no_nutrition',
    ],
    [{ cached: { id: 'x', name: 'Wrong', is_hidden: true } }, 'hidden'],
  ] as const) {
    const { deps } = setup(opts as never);
    const body = await (await handle(post({ barcode: '3017620422003' }), deps)).json();
    assertEquals(body.found, false);
    assertEquals(body.reason, reason);
  }
});

Deno.test('Open Food Facts down and nothing cached: clear error', async () => {
  const { deps } = setup({ offDown: true });
  const res = await handle(post({ barcode: '3017620422003' }), deps);
  assertEquals(res.status, 502);
  assertMatch((await res.json()).message, /add the food yourself/);
});

Deno.test('rate limited per user: 429 before calling Open Food Facts', async () => {
  const { deps, state } = setup({ limited: true });
  const res = await handle(post({ barcode: '3017620422003' }), deps);
  assertEquals(res.status, 429);
  assertEquals(state.fetches.length, 0);
});

Deno.test(
  'search: my own and cached foods first, then Open Food Facts results (cached)',
  async () => {
    const { deps, state } = setup({
      local: [{ id: 'mine', name: 'Nutella pancakes', owner_id: USER }],
      search: [
        nutella,
        { code: '1', product_name: 'no barcode' },
        { code: '5000112637922', product_name: 'Cola', nutriments: { energy_100g: 176 } },
      ],
    });
    const body = await (await handle(post({ query: 'nutella' }), deps)).json();
    assertEquals(
      body.foods.map((f: Food) => f.name),
      ['Nutella pancakes', 'Nutella', 'Cola'],
    );
    assertEquals(body.foods[2].kcal_100g, 42.1); // 176 kJ → kcal
    assertMatch(state.fetches[0]!.url, /search_terms=nutella/);
    assertEquals(state.rates, ['search']);
  },
);

Deno.test('search rate limited: local results only', async () => {
  const { deps, state } = setup({ limited: true, local: [{ id: 'f1', name: 'Nutella' }] });
  const body = await (await handle(post({ query: 'nut' }), deps)).json();
  assertEquals(body, { foods: [{ id: 'f1', name: 'Nutella' }], partial: true });
  assertEquals(state.fetches.length, 0);
});

Deno.test('bad input and not signed in', async () => {
  const { deps } = setup();
  assertEquals((await handle(post({ barcode: 'abc' }), deps)).status, 400);
  assertEquals((await handle(post({ query: 'a' }), deps)).status, 400);
  assertEquals((await handle(post({ barcode: '3017620422003' }, 'Bearer x'), deps)).status, 401);
});

Deno.test('toFood: kJ fallback, caps and missing fields', () => {
  assertEquals(
    toFood({ code: '12345678', product_name: 'X', nutriments: { energy_100g: '418,4' } })
      ?.kcal_100g,
    100,
  );
  assertEquals(toFood({ code: '12345678', product_name: 'X', nutriments: {} }), null);
  assert(
    toFood({ code: '12345678', product_name: 'X', nutriments: { 'energy-kcal_100g': 2000 } }) ===
      null,
  );
});
