import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';

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

  const checkAdminStatus = useCallback(async (u: User | null): Promise<boolean> => {
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
    if (email) {
      const { data: byEmail, error: errEmail } = await supabase
        .from('admins')
        .select('id')
        .ilike('email', email)
        .maybeSingle();

      logSupabaseError('AuthContext.checkAdminStatus.byEmail', errEmail);

      const ok = !!byEmail && !errEmail;
      setIsAdmin(ok);
      authDebug({ phase: 'admin', match: ok ? 'email' : 'none', userId: u.id, email: u.email, ok });
      return ok;
    }

    setIsAdmin(false);
    authDebug({ phase: 'admin', match: 'none', userId: u.id, email: u.email });
    return false;
  }, []);

  const applySession = useCallback(
    async (session: Session | null) => {
      setVerifying(true);
      try {
        const u = session?.user ?? null;
        setUser(u);
        await checkAdminStatus(u);
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
