import { getSupabase } from '@/lib/supabase';
import type { Tables, TablesUpdate } from '@/types/database';

export type Profile = Tables<'profiles'>;
// role is left out on purpose: the server rejects role changes from the app.
export type ProfileUpdate = Omit<
  TablesUpdate<'profiles'>,
  'id' | 'role' | 'created_at' | 'updated_at'
>;

export class UsernameTakenError extends Error {
  constructor() {
    super('That username is taken');
  }
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Upsert so onboarding still works if the signup trigger didn't create the row. */
export async function saveProfile(userId: string, patch: ProfileUpdate): Promise<Profile> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .upsert({ ...patch, id: userId })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new UsernameTakenError();
    throw error;
  }
  return data;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('is_username_available', { name: username });
  if (error) throw error;
  return data;
}

/** Uploads to avatars/<userId>/... and returns the public URL. */
export async function uploadAvatar(
  userId: string,
  file: { uri: string; mimeType?: string | null },
): Promise<string> {
  const contentType = file.mimeType ?? 'image/jpeg';
  const ext = contentType.split('/')[1] ?? 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  // fetch() reads file://, blob: and data: URIs on native and web alike.
  const body = await (await fetch(file.uri)).arrayBuffer();

  const storage = getSupabase().storage.from('avatars');
  const { error } = await storage.upload(path, body, { contentType, upsert: true });
  if (error) throw error;
  return storage.getPublicUrl(path).data.publicUrl;
}
