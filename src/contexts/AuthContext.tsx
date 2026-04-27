import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { env } from '../config/env.js';

export interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

function authDebug(payload: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    console.log('[Auth]', payload);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const loading = initializing || verifying;

  const checkAdminStatus = useCallback(
    async (u: User | null, accessToken: string | null): Promise<boolean> => {
      if (!u) {
        setIsAdmin(false);
        authDebug({ phase: 'admin', result: 'no_user' });
        return false;
      }

      const { data: byId, error: errId } = await supabase
        .from('admins')
        .select('id')
        .eq('id', u.id)
        .maybeSingle();

      logSupabaseError('AuthContext.checkAdminStatus.byId', errId);

      if (byId && !errId) {
        setIsAdmin(true);
        authDebug({ phase: 'admin', match: 'id', userId: u.id, email: u.email });
        return true;
      }

      const email = u.email?.trim();
      let errEmail: typeof errId = null;
      let byEmail: { id: string } | null = null;
      if (email) {
        const byEmailRes = await supabase
          .from('admins')
          .select('id')
          .ilike('email', email)
          .maybeSingle();
        byEmail = byEmailRes.data as { id: string } | null;
        errEmail = byEmailRes.error;
        logSupabaseError('AuthContext.checkAdminStatus.byEmail', errEmail);

        if (byEmail && !errEmail) {
          setIsAdmin(true);
          authDebug({ phase: 'admin', match: 'email', userId: u.id, email: u.email });
          return true;
        }
      }

      const queryErrored = Boolean(errId || errEmail);
      const tryApi =
        queryErrored &&
        Boolean(accessToken) &&
        env.apiUrlConfigured &&
        Boolean(env.apiUrl);

      if (tryApi) {
        console.warn('[Auth] admins Supabase queries failed; trying GET /api/admin/verify');
        try {
          const r = await fetch(`${env.apiUrl}/api/admin/verify`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const j = (await r.json().catch(() => null)) as { isAdmin?: boolean; error?: string } | null;
          if (r.ok && typeof j?.isAdmin === 'boolean') {
            setIsAdmin(j.isAdmin);
            authDebug({
              phase: 'admin',
              match: j.isAdmin ? 'api-verify' : 'api-verify-none',
              userId: u.id,
              email: u.email,
              ok: j.isAdmin,
            });
            return j.isAdmin;
          }
          console.error('[Auth] /api/admin/verify failed', r.status, j?.error);
        } catch (e) {
          console.error('[Auth] /api/admin/verify fetch error', e);
        }
      }

      setIsAdmin(false);
      authDebug({ phase: 'admin', match: 'none', userId: u.id, email: u.email });
      return false;
    },
    [env.apiUrl, env.apiUrlConfigured]
  );

  const applySession = useCallback(
    async (session: Session | null) => {
      setVerifying(true);
      try {
        const u = session?.user ?? null;
        setUser(u);
        await checkAdminStatus(u, session?.access_token ?? null);
      } finally {
        setVerifying(false);
      }
    },
    [checkAdminStatus]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { data: { session }, error: err } = await supabase.auth.getSession();
        if (err) {
          console.error('[AuthContext.bootstrap.getSession]', err.message);
        }
        if (!cancelled) {
          await applySession(session ?? null);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      authDebug({ phase: 'auth-state', event, hasSession: !!session });
      void applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [applySession]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[Auth] snapshot', {
        user: user ? { id: user.id, email: user.email } : null,
        isAdmin,
        loading,
      });
    }
  }, [user, isAdmin, loading]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    authDebug({ phase: 'signIn', ok: true, email });
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setIsAdmin(false);
    authDebug({ phase: 'signOut' });
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAdmin, loading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
