import { FunctionsHttpError } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

export type Photo = Tables<'progress_photos'> & { url: string | null };
export type Pose = Tables<'progress_photos'>['pose'];

/** The unlock token was refused (wrong, expired or re-locked): show the lock again. */
export class PhotosLockedError extends Error {
  constructor() {
    super('Photos are locked');
    this.name = 'PhotosLockedError';
  }
}

/**
 * Everything goes through the `photos` Edge Function with the unlock token;
 * the app has no direct access to photo rows or files.
 */
async function callPhotos<T>(token: string, body: Record<string, unknown> | FormData): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('photos', {
    body,
    headers: { 'x-photo-unlock': token },
  });
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    if (res.status === 403) throw new PhotosLockedError();
    const message = await res
      .json()
      .then((b: { error?: string }) => b.error ?? null)
      .catch(() => null);
    if (res.status === 404 && !message) {
      throw Object.assign(new Error('The photos Edge Function isn’t deployed yet.'), {
        code: 'EDGE_FUNCTION_MISSING',
      });
    }
    throw Object.assign(new Error(message ?? error.message), { status: res.status });
  }
  if (error) throw error;
  return data as T;
}

/** Own photos, newest first, with signed URLs that expire with the unlock. */
export async function fetchPhotos(token: string): Promise<Photo[]> {
  const result = await callPhotos<{ photos: Photo[] }>(token, { action: 'list' });
  return result.photos;
}

/** Uploads an already compressed JPEG. The server picks the path (own folder). */
export async function uploadPhoto(
  token: string,
  image: { uri: string; width: number; height: number },
  meta: { takenOn: string; pose: Pose },
): Promise<void> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    form.append('file', await (await fetch(image.uri)).blob(), 'photo.jpg');
  } else {
    // React Native's FormData streams the file from its URI.
    form.append('file', { uri: image.uri, name: 'photo.jpg', type: 'image/jpeg' } as never);
  }
  form.append('taken_on', meta.takenOn);
  form.append('pose', meta.pose);
  form.append('width', String(image.width));
  form.append('height', String(image.height));
  await callPhotos(token, form);
}

export async function deletePhoto(token: string, photo: Pick<Photo, 'id'>): Promise<void> {
  await callPhotos(token, { action: 'delete', id: photo.id });
}
