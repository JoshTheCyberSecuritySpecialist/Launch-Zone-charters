import type { PostgrestError } from '@supabase/supabase-js';

/** Postgrest rows + Storage uploads share `message`; only Postgrest has code/details. */
type LoggableSupabaseError = PostgrestError | { message: string; code?: string; details?: string };

export function logSupabaseError(context: string, error: LoggableSupabaseError | null | undefined): void {
  if (!error) {
    return;
  }
  const code = 'code' in error && error.code != null ? String(error.code) : '';
  const details = 'details' in error && error.details != null ? String(error.details) : '';
  console.error(`[Supabase:${context}]`, error.message, code, details);
}

export function userFacingSupabaseMessage(error: PostgrestError | null | undefined): string {
  if (!error?.message) {
    return 'Something went wrong. Please try again.';
  }
  return error.message;
}
