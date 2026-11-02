import { callFunction } from './functions';

export type PreparedExport = { blob: Blob; filename: string; size: number };

/**
 * Builds the export on the server (zip: CSVs + data.json). Photos are added
 * only with a photo unlock token.
 */
export async function prepareExport(photoToken?: string | null): Promise<PreparedExport> {
  const res = await callFunction('export-data', {
    headers: photoToken ? { 'x-photo-unlock': photoToken } : {},
  });
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'lightweightbaby-export.zip';
  return { blob, filename, size: blob.size };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
