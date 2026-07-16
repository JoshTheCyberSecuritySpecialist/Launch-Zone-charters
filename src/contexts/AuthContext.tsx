import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { env } from '../config/env.js';
import { adminDebugLog, describeError, fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

type SupabaseLogError = Parameters<typeof logSupabaseError>[1];

export interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  authError: string | null;
  retryAuth: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const bootstrappedRef = useRef(false);
  const verifiedUserIdRef = useRef<string | null>(null);

  const loading = initializing || verifying;

  const checkAdminStatus = useCallback(
    async (u: User | null, accessToken: string | null): Promise<boolean> => {
      if (!u) {
        setIsAdmin(false);
        adminDebugLog('auth:admin:no-user');
        return false;
      }

      adminDebugLog('auth:admin:verify-start', { userId: u.id, hasEmail: Boolean(u.email) });

      let errId: SupabaseLogError = null;
      let errEmail: SupabaseLogError = null;
      let adminVerifyTimeoutError: string | null = null;
      let byId: { id: string } | null = null;
      let byEmail: { id: string } | null = null;

      try {
        const byIdRes = await withTimeout(
          'Admin verification by user id',
          supabase
            .from('admins')
            .select('id')
            .eq('id', u.id)
            .maybeSingle(),
          12000
        );
        byId = byIdRes.data as { id: string } | null;
        errId = byIdRes.error;
      } catch (err) {
        adminVerifyTimeoutError = describeError(err);
        console.error('[AuthContext.checkAdminStatus.byId]', adminVerifyTimeoutError);
      }

      logSupabaseError('AuthContext.checkAdminStatus.byId', errId);

      if (byId && !errId) {
        setIsAdmin(true);
        adminDebugLog('auth:admin:verified', { match: 'id', userId: u.id });
        return true;
      }

      const email = u.email?.trim();
      if (email) {
        try {
          const byEmailRes = await withTimeout(
            'Admin verification by email',
            supabase
              .from('admins')
              .select('id')
              .ilike('email', email)
              .maybeSingle(),
            12000
          );
          byEmail = byEmailRes.data as { id: string } | null;
          errEmail = byEmailRes.error;
        } catch (err) {
          adminVerifyTimeoutError = describeError(err);
          console.error('[AuthContext.checkAdminStatus.byEmail]', adminVerifyTimeoutError);
        }
        logSupabaseError('AuthContext.checkAdminStatus.byEmail', errEmail);

        if (byEmail && !errEmail) {
          setIsAdmin(true);
          adminDebugLog('auth:admin:verified', { match: 'email', userId: u.id });
          return true;
        }
      }

      const queryErrored = Boolean(errId || errEmail || adminVerifyTimeoutError);
      const tryApi =
        queryErrored &&
        Boolean(accessToken) &&
        env.apiUrlConfigured &&
        Boolean(env.apiUrl);

      if (tryApi) {
        console.warn('[Auth] admins Supabase queries failed; trying GET /api/admin/verify');
        try {
          const j = await fetchJsonWithTimeout<{ isAdmin?: boolean; error?: string }>('auth:admin:api-verify', `${env.apiUrl}/api/admin/verify`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }, 12000);
          if (typeof j?.isAdmin === 'boolean') {
            setIsAdmin(j.isAdmin);
            adminDebugLog('auth:admin:api-verify-complete', {
              match: j.isAdmin ? 'api-verify' : 'api-verify-none',
              userId: u.id,
              ok: j.isAdmin,
            });
            return j.isAdmin;
          }
          console.error('[Auth] /api/admin/verify failed', j?.error);
        } catch (e) {
          console.error('[Auth] /api/admin/verify fetch error', e);
        }
      }

      setIsAdmin(false);
      adminDebugLog('auth:admin:not-authorized', { userId: u.id });
      return false;
    },
    [env.apiUrl, env.apiUrlConfigured]
  );

  const applySession = useCallback(
    async (session: Session | null, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setVerifying(true);
      }
      setAuthError(null);
      try {
        const u = session?.user ?? null;
        adminDebugLog('auth:session:apply', { hasSession: Boolean(session), hasUser: Boolean(u), silent: options?.silent });
        setUser(u);
        await checkAdminStatus(u, session?.access_token ?? null);
        verifiedUserIdRef.current = u?.id ?? null;
      } catch (err) {
        const message = describeError(err, 'Could not restore admin session.');
        console.error('[AuthContext.applySession]', message);
        setUser(null);
        setIsAdmin(false);
        verifiedUserIdRef.current = null;
        setAuthError(message);
      } finally {
        if (!options?.silent) {
          setVerifying(false);
        }
      }
    },
    [checkAdminStatus]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        adminDebugLog('auth:bootstrap:start', { localStorageAvailable: canUseLocalStorage() });
        const { data: { session }, error: err } = await withTimeout(
          'Supabase auth session restore',
          supabase.auth.getSession(),
          12000
        );
        if (err) {
          console.error('[AuthContext.bootstrap.getSession]', err.message);
          setAuthError(err.message);
        }
        if (!cancelled) {
          adminDebugLog('auth:bootstrap:session-restored', { hasSession: Boolean(session), hasUser: Boolean(session?.user) });
          await applySession(session ?? null);
        }
      } catch (err) {
        const message = describeError(err, 'Could not restore admin session.');
        console.error('[AuthContext.bootstrap]', message);
        if (!cancelled) {
          setUser(null);
          setIsAdmin(false);
          setAuthError(message);
        }
      } finally {
        if (!cancelled) {
          bootstrappedRef.current = true;
          setInitializing(false);
        }
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      adminDebugLog('auth:state-change', { event, hasSession: Boolean(session) });
      const nextUserId = session?.user?.id ?? null;

      if (event === 'INITIAL_SESSION' && bootstrappedRef.current) {
        return;
      }

      if (
        event === 'TOKEN_REFRESHED' &&
        nextUserId &&
        nextUserId === verifiedUserIdRef.current &&
        session?.user
      ) {
        setUser(session.user);
        return;
      }

      void applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [applySession, authAttempt]);

  useEffect(() => {
    if (import.meta.env.DEV) {
        console.log('[Auth] snapshot', {
        user: user ? { id: user.id, email: user.email } : null,
        isAdmin,
        loading,
        authError,
      });
    }
  }, [user, isAdmin, loading, authError]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setAuthError(null);
    adminDebugLog('auth:sign-in', { ok: true, hasEmail: Boolean(email) });
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setIsAdmin(false);
    setAuthError(null);
    verifiedUserIdRef.current = null;
    adminDebugLog('auth:sign-out');
  }, []);

  const retryAuth = useCallback(() => {
    setAuthError(null);
    setInitializing(true);
    setAuthAttempt((prev) => prev + 1);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAdmin, loading, authError, retryAuth, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function canUseLocalStorage() {
  try {
    const key = '__lz_admin_auth_test__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
