import { newId } from '@/lib/id';
import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

export type Photo = Tables<'progress_photos'> & { url: string | null };
export type Pose = Tables<'progress_photos'>['pose'];

const BUCKET = 'progress-photos';
const URL_TTL_SECONDS = 60 * 60;

/** The user's photos, newest first, each with a signed URL (the bucket is private). */
export async function fetchPhotos(): Promise<Photo[]> {
  const { data, error } = await getSupabase()
    .from('progress_photos')
    .select('*')
    .order('taken_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (data.length === 0) return [];

  const { data: signed, error: signError } = await getSupabase()
    .storage.from(BUCKET)
    .createSignedUrls(
      data.map((p) => p.storage_path),
      URL_TTL_SECONDS,
    );
  if (signError) throw signError;
  const urls = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return data.map((p) => ({ ...p, url: urls.get(p.storage_path) ?? null }));
}

/** Uploads an already compressed JPEG into <user id>/<photo id>.jpg and records it. */
export async function uploadPhoto(
  userId: string,
  image: { uri: string; width: number; height: number },
  meta: { takenOn: string; pose: Pose },
): Promise<void> {
  const id = newId();
  const path = `${userId}/${id}.jpg`;
  const body = await (await fetch(image.uri)).arrayBuffer();
  const storage = getSupabase().storage.from(BUCKET);

  const { error: uploadError } = await storage.upload(path, body, { contentType: 'image/jpeg' });
  if (uploadError) throw uploadError;

  const { error } = await getSupabase().from('progress_photos').insert({
    id,
    storage_path: path,
    width: image.width,
    height: image.height,
    taken_on: meta.takenOn,
    pose: meta.pose,
  });
  if (error) {
    // Don't leave an orphaned file behind.
    await storage.remove([path]);
    throw error;
  }
}

export async function deletePhoto(photo: Pick<Photo, 'id' | 'storage_path'>): Promise<void> {
  const { error: fileError } = await getSupabase()
    .storage.from(BUCKET)
    .remove([photo.storage_path]);
  if (fileError) throw fileError;
  const { error } = await getSupabase().from('progress_photos').delete().eq('id', photo.id);
  if (error) throw error;
}
