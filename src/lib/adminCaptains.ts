import { supabase } from './supabase';
import type { CaptainsRow } from './supabase';

export type AdminCaptainListItem = Pick<
  CaptainsRow,
  'id' | 'full_name' | 'phone' | 'email' | 'active' | 'default_boat_id' | 'auth_user_id' | 'photo_url' | 'notes'
>;

export async function fetchActiveCaptains(): Promise<AdminCaptainListItem[]> {
  const { data, error } = await supabase
    .from('captains')
    .select('id, full_name, phone, email, active, default_boat_id, auth_user_id, photo_url, notes')
    .eq('active', true)
    .order('full_name', { ascending: true });

  if (error) throw error;
  return (data || []) as AdminCaptainListItem[];
}

export async function fetchAllCaptains(): Promise<AdminCaptainListItem[]> {
  const { data, error } = await supabase
    .from('captains')
    .select('id, full_name, phone, email, active, default_boat_id, auth_user_id, photo_url, notes')
    .order('full_name', { ascending: true });

  if (error) throw error;
  return (data || []) as AdminCaptainListItem[];
}
