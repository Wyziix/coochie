// deno test supabase/functions. Database and storage are faked; the zip is real.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { unzipSync, zipSync } from 'npm:fflate@0.8.2';

import { localDateTime, toCsv } from './csv.ts';
import { type Deps, handle } from './handler.ts';

const USER = 'aaaa0000-0000-0000-0000-000000000001';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const dump = () => ({
  exported_at: '2026-11-02T17:00:00Z',
  profile: { username: 'gleb', units: 'kg' },
  workouts: [
    {
      id: 'w1',
      name: 'Push, day "A"',
      started_at: '2026-11-01T16:05:00+00:00',
      ended_at: '2026-11-01T17:00:00+00:00',
      duration_seconds: 3300,
      total_volume_kg: 2437.5,
      notes: '=HYPERLINK("x")',
    },
  ],
  sets: [
    {
      workout_id: 'w1',
      workout_started_at: '2026-11-01T16:05:00+00:00',
      exercise: 'Bench press',
      exercise_order: 0,
      set_order: 1,
      set_type: 'normal',
      weight_kg: 82.5,
      reps: 5,
      rpe: 8.5,
    },
  ],
  templates: [
    {
      name: 'Push',
      program: null,
      notes: null,
      exercises: [
        { exercise: 'Bench press', position: 0, target_sets: 3 },
        { exercise: 'Dips', position: 1, target_sets: 3 },
      ],
    },
    { name: 'Empty', exercises: [] },
  ],
  personal_records: [
    {
      exercise: 'Bench press',
      record_type: 'weight',
      value: 82.5,
      achieved_at: '2026-11-01T16:30:00Z',
    },
  ],
  body_stats: [
    { measured_on: '2026-11-01', bodyweight_kg: 70.4, waist_cm: 81.5, notes: 'morning, fasted' },
  ],
  food_logs: [
    {
      day: '2026-11-01',
      meal: 'dinner',
      name: 'Café con leche',
      grams: 250,
      kcal: 112.5,
      protein_g: 8,
      carbs_g: 11.2,
      fat_g: 4,
    },
  ],
  water: [{ day: '2026-11-01', ml: 500, logged_at: '2026-11-01T09:00:00Z' }],
  points: [
    {
      earned_at: '2026-11-01T17:00:00Z',
      day: '2026-11-01',
      points: 10,
      reason: 'workout',
      source: 'workout',
      workout_id: 'w1',
    },
  ],
  badges: [
    {
      badge: 'First workout',
      description: 'Log your first workout',
      earned_at: '2026-11-01T17:00:00Z',
    },
  ],
  progress_photos: [
    {
      id: 'p1aaaaaa-0000',
      taken_on: '2026-11-01',
      pose: 'front',
      storage_path: `${USER}/front.jpg`,
    },
  ],
});

function setup(opts: { rateLimited?: boolean; photos?: boolean } = {}) {
  const state = { downloads: [] as string[], unlockAsked: 0 };
  const deps: Deps = {
    userIdFromAuth: (a) => Promise.resolve(a === 'Bearer user-jwt' ? USER : null),
    rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      if (fn !== 'export_user_data' || args.p_user !== USER) throw new Error(`unexpected ${fn}`);
      if (opts.rateLimited)
        return Promise.reject(new Error('export_user_data: Too many requests. Try again later.'));
      const d = dump();
      if (opts.photos === false) d.progress_photos = [];
      return Promise.resolve(d as T);
    },
    unlockedPhotos(_a, token) {
      state.unlockAsked++;
      return Promise.resolve(
        token === 'good'
          ? [
              {
                id: 'p1aaaaaa-0000',
                storage_path: `${USER}/front.jpg`,
                taken_on: '2026-11-01',
                pose: 'front',
              },
              {
                id: 'p2',
                storage_path: 'someone-else/x.jpg',
                taken_on: '2026-11-01',
                pose: 'side',
              },
            ]
          : null,
      );
    },
    downloadPhoto(path) {
      state.downloads.push(path);
      return Promise.resolve(JPEG);
    },
    zip: (files) =>
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([k, f]) => [k, [f.data, { level: f.compress ? 6 : 0 }]]),
        ),
      ),
    now: () => new Date('2026-11-02T23:30:00Z'),
  };
  return { deps, state };
}

const post = (headers: Record<string, string> = {}) =>
  new Request('http://fn/export-data', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', ...headers },
  });

async function unzip(res: Response) {
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  return { files, text: (name: string) => decoder.decode(files[name]!) };
}

Deno.test('a zip of CSVs plus the full JSON, named with the Madrid date', async () => {
  const { deps, state } = setup();
  const res = await handle(post(), deps);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('content-type'), 'application/zip');
  assertEquals(
    res.headers.get('content-disposition'),
    'attachment; filename="lightweightbaby-export-2026-11-03.zip"',
  );
  const { files, text } = await unzip(res);
  assertEquals(Object.keys(files).sort(), [
    'README.txt',
    'badges.csv',
    'body_stats.csv',
    'data.json',
    'nutrition.csv',
    'personal_records.csv',
    'points.csv',
    'sets.csv',
    'templates.csv',
    'water.csv',
    'workouts.csv',
  ]);
  const json = JSON.parse(text('data.json'));
  assertEquals(json.profile.username, 'gleb');
  assertEquals(json.progress_photos, [
    { id: 'p1aaaaaa-0000', taken_on: '2026-11-01', pose: 'front', file: null },
  ]);
  assert(!text('data.json').includes('storage_path'), 'no storage paths in the export');
  assertMatch(text('README.txt'), /not included\. Unlock photos/);
  assertEquals(state.downloads.length, 0, 'no photos without the unlock');
});

Deno.test(
  'CSV opens cleanly in Excel: BOM, CRLF, ISO dates, dot decimals, quoting, no formulas',
  async () => {
    const { text } = await unzip(await handle(post(), setup().deps));
    const workouts = text('workouts.csv');
    assert(workouts.startsWith('﻿'), 'UTF-8 BOM');
    assertEquals(workouts.split('\r\n'), [
      '﻿id,name,started_at,ended_at,duration_seconds,total_volume_kg,notes',
      // 16:05 UTC is 17:05 in Madrid (CET) on 1 November.
      'w1,"Push, day ""A""",2026-11-01 17:05:00,2026-11-01 18:00:00,3300,2437.5,"\'=HYPERLINK(""x"")"',
      '',
    ]);
    assertEquals(
      text('sets.csv').split('\r\n')[1],
      'w1,2026-11-01 17:05:00,Bench press,0,1,normal,82.5,5,8.5,,',
    );
    assertEquals(
      text('nutrition.csv').split('\r\n')[1],
      '2026-11-01,dinner,Café con leche,250,,112.5,8,11.2,4',
    );
    assertEquals(
      text('body_stats.csv').split('\r\n')[1],
      '2026-11-01,70.4,,,,,81.5,,,,,"morning, fasted"',
    );
    assertEquals(text('templates.csv').split('\r\n').slice(1, 4), [
      'Push,,,Bench press,0,3,,,,',
      'Push,,,Dips,1,3,,,,',
      'Empty,,,,,,,,,',
    ]);
  },
);

Deno.test('photos only with a valid photo unlock, only the user’s own files', async () => {
  const { deps, state } = setup();
  const locked = await handle(post({ 'x-photo-unlock': 'bad' }), deps);
  assertEquals(locked.status, 403);
  const res = await handle(post({ 'x-photo-unlock': 'good' }), deps);
  const { files, text } = await unzip(res);
  assertEquals(state.downloads, [`${USER}/front.jpg`]);
  assertEquals(Array.from(files['photos/2026-11-01-front-p1aaaaaa.jpg']!), Array.from(JPEG));
  assertEquals(
    JSON.parse(text('data.json')).progress_photos[0].file,
    'photos/2026-11-01-front-p1aaaaaa.jpg',
  );
  assertMatch(text('README.txt'), /1 progress photos are in the photos folder/);
});

Deno.test('no photos at all: the unlock is not needed', async () => {
  const { deps, state } = setup({ photos: false });
  const { text } = await unzip(await handle(post({ 'x-photo-unlock': 'bad' }), deps));
  assertMatch(text('README.txt'), /No progress photos/);
  assertEquals(state.unlockAsked, 0);
});

Deno.test('signed out, rate limit, wrong method', async () => {
  assertEquals(
    (await handle(new Request('http://fn', { method: 'POST' }), setup().deps)).status,
    401,
  );
  const limited = await handle(post(), setup({ rateLimited: true }).deps);
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error, 'rate_limited');
  assertEquals(
    (await handle(new Request('http://fn', { method: 'GET' }), setup().deps)).status,
    405,
  );
});

Deno.test('csv helpers: Madrid summer time, empty and odd values', () => {
  assertEquals(localDateTime('2026-07-01T10:00:00Z'), '2026-07-01 12:00:00');
  assertEquals(
    toCsv(
      [{ a: 0.0000001, b: '-5 kg', c: null, d: 'line\nbreak' }],
      [{ key: 'a', kind: 'number' }, { key: 'b' }, { key: 'c', kind: 'number' }, { key: 'd' }],
    ),
    '﻿a,b,c,d\r\n0.0000001,\'-5 kg,,"line\nbreak"\r\n',
  );
});
