import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const url = typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '';
const key = typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : '';

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

/** Single Supabase browser client for the entire app (anon key only). */
export const supabase = createClient(url, key);
