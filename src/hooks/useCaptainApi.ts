import { useCallback } from 'react';
import { env } from '../config/env.js';
import { withTimeout } from '../lib/adminDiagnostics';
import { supabase } from '../lib/supabase';

export function useCaptainApi() {
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await withTimeout('Captain session lookup', supabase.auth.getSession(), 12000);
    return data.session?.access_token || null;
  }, []);

  const captainFetch = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        throw new Error('API URL is not configured.');
      }
      const token = await getToken();
      if (!token) throw new Error('Session expired. Sign in again.');

      const res = await withTimeout(
        `Captain ${path}`,
        fetch(`${env.apiUrl}${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init.headers || {}),
          },
        }),
        20000
      );

      const body = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        throw new Error(body?.error || 'Request failed.');
      }
      return body;
    },
    [getToken]
  );

  return { captainFetch, getToken };
}
