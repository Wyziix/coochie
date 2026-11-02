// POST with the user's JWT → a zip of CSVs (Excel-friendly) plus data.json
// with everything. Progress photos are added only when the request carries a
// valid photo unlock token (x-photo-unlock), checked as the user by
// photo_list(). Limited to 5 exports an hour (export_user_data()).
// Testable with fakes (handler.test.ts).
import { localDate, TABLES, TIME_ZONE, toCsv } from './csv.ts';

export type Photo = {
  id: string;
  storage_path: string;
  taken_on?: string | null;
  pose?: string | null;
};

export type Deps = {
  userIdFromAuth(authorization: string): Promise<string | null>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** The user's photos if the unlock token is valid for them, else null. */
  unlockedPhotos(authorization: string, token: string): Promise<Photo[] | null>;
  downloadPhoto(path: string): Promise<Uint8Array>;
  zip(files: Record<string, { data: Uint8Array; compress: boolean }>): Uint8Array;
  now?(): Date;
};

/** Photos stop being added past this (Edge Function memory). */
export const MAX_PHOTO_BYTES = 100 * 1024 * 1024;

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-photo-unlock',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const encoder = new TextEncoder();

function readme(opts: { photos: 'none' | 'locked' | number; skipped: number }): string {
  const photos =
    opts.photos === 'none'
      ? 'No progress photos (you have none).'
      : opts.photos === 'locked'
        ? 'Progress photos are not included. Unlock photos in the app first to include them.'
        : `${opts.photos} progress photos are in the photos folder.` +
          (opts.skipped
            ? ` ${opts.skipped} more were left out because the export got too big.`
            : '');
  return [
    'LightweightBaby data export',
    '',
    'data.json has everything. The CSV files open in Excel, Numbers and Google Sheets:',
    'UTF-8, comma separated, dates as YYYY-MM-DD, decimals with a dot.',
    `Times are local time in ${TIME_ZONE}. Weights are in kg, lengths in cm, water in ml.`,
    'If Excel puts everything in one column (comma not your list separator), use',
    'Data > From Text/CSV and pick "Comma".',
    '',
    photos,
    '',
  ].join('\r\n');
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method', message: 'Method not allowed' }, 405);

  const authorization = req.headers.get('authorization') ?? '';
  const userId = await deps.userIdFromAuth(authorization).catch(() => null);
  if (!userId) return json({ error: 'auth', message: 'Sign in again.' }, 401);

  let data: Record<string, unknown>;
  try {
    data = await deps.rpc<Record<string, unknown>>('export_user_data', { p_user: userId });
  } catch (error) {
    if (/too many requests/i.test(String((error as Error)?.message))) {
      return json(
        {
          error: 'rate_limited',
          message: 'You exported several times already. Try again in an hour.',
        },
        429,
      );
    }
    return json(
      { error: 'export_failed', message: 'Couldn’t build the export. Try again in a minute.' },
      500,
    );
  }

  const files: Record<string, { data: Uint8Array; compress: boolean }> = {};
  for (const table of TABLES) {
    const rows = (data[table.key] as Record<string, unknown>[] | undefined) ?? [];
    files[table.file] = {
      data: encoder.encode(toCsv(table.flatten ? table.flatten(rows) : rows, table.columns)),
      compress: true,
    };
  }

  // Photos: only after the photo lock was opened on this device.
  const listed = (data.progress_photos as Photo[] | undefined) ?? [];
  const token = req.headers.get('x-photo-unlock') ?? '';
  let photos: 'none' | 'locked' | number = listed.length ? 'locked' : 'none';
  let skipped = 0;
  const photoList: { file: string; id: string; taken_on: unknown; pose: unknown }[] = [];
  if (listed.length && token) {
    const unlocked = await deps.unlockedPhotos(authorization, token).catch(() => null);
    if (!unlocked)
      return json({ error: 'locked', message: 'Unlock your photos again, then export.' }, 403);
    let bytes = 0;
    let added = 0;
    for (const p of unlocked) {
      if (!p.storage_path.startsWith(`${userId}/`)) continue;
      if (bytes >= MAX_PHOTO_BYTES) {
        skipped++;
        continue;
      }
      const file = await deps.downloadPhoto(p.storage_path).catch(() => null);
      if (!file) {
        skipped++;
        continue;
      }
      bytes += file.byteLength;
      const name = `photos/${p.taken_on ?? 'undated'}-${p.pose ?? 'photo'}-${p.id.slice(0, 8)}.jpg`;
      files[name] = { data: file, compress: false };
      photoList.push({ file: name, id: p.id, taken_on: p.taken_on, pose: p.pose });
      added++;
    }
    photos = added;
  }

  // In the JSON, photos are listed (with their file in the zip when included),
  // never with storage paths.
  const full = {
    ...data,
    progress_photos: listed.map((p) => ({
      id: p.id,
      taken_on: p.taken_on ?? null,
      pose: p.pose ?? null,
      file: photoList.find((x) => x.id === p.id)?.file ?? null,
    })),
  };
  files['data.json'] = { data: encoder.encode(JSON.stringify(full, null, 2)), compress: true };
  files['README.txt'] = { data: encoder.encode(readme({ photos, skipped })), compress: true };

  const zipped = deps.zip(files);
  const filename = `lightweightbaby-export-${localDate(deps.now?.() ?? new Date())}.zip`;
  return new Response(new Blob([zipped as Uint8Array<ArrayBuffer>]), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
