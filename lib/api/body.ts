import { getSupabase } from '@/lib/supabase';
import type { Tables, TablesInsert } from '@/types/database';

export type Measurement = Tables<'body_measurements'>;
export type MeasurementInput = Omit<TablesInsert<'body_measurements'>, 'id' | 'user_id'>;

export async function fetchMeasurements(): Promise<Measurement[]> {
  const { data, error } = await getSupabase()
    .from('body_measurements')
    .select('*')
    .order('measured_on', { ascending: false });
  if (error) throw error;
  return data;
}

/** One entry per day: logging the same day again updates it. The server copies the newest bodyweight to the profile. */
export async function saveMeasurement(input: MeasurementInput): Promise<Measurement> {
  const { data, error } = await getSupabase()
    .from('body_measurements')
    .upsert(input, { onConflict: 'user_id,measured_on' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMeasurement(id: string): Promise<void> {
  const { error } = await getSupabase().from('body_measurements').delete().eq('id', id);
  if (error) throw error;
}
