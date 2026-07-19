import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Logo from '../components/ui/Logo';
import { beginAsyncInteraction } from '../lib/clickPerf';
import type { AuthError } from '@supabase/supabase-js';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminDocumentHead from '../components/admin/AdminDocumentHead';
import { safeAdminRedirectPath } from '../lib/adminLoginRedirect';

function supabaseHostForLog(): string {
  const u = import.meta.env.VITE_SUPABASE_URL;
  if (typeof u !== 'string' || !u.trim()) return '(VITE_SUPABASE_URL unset)';
  try {
    return new URL(u.trim()).host;
  } catch {
    return '(invalid VITE_SUPABASE_URL)';
  }
}

function formatAdminAuthError(err: AuthError | Error, cause?: unknown): string {
  const message = err?.message || 'Failed to sign in';
  const lower = message.toLowerCase();
  const isNetworkish =
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('load failed') ||
    (err as AuthError & { name?: string })?.name === 'AuthRetryableFetchError';
  const causeStr = cause instanceof Error ? cause.message : '';
  let out = causeStr && !message.includes(causeStr) ? `${message} (${causeStr})` : message;
  if (isNetworkish) {
    out +=
      ' The browser could not reach Supabase Auth. On Vercel, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your project, then redeploy. Check the network tab for calls to your Supabase host.';
  }
  return out;
}

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const redirectTo = useMemo(
    () => safeAdminRedirectPath((location.state as { from?: string } | null)?.from),
    [location.state]
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user && isAdmin) {
      navigate(redirectTo, { replace: true });
    }
  }, [authLoading, isAdmin, navigate, redirectTo, user]);

  if (authLoading) {
    return (
      <>
        <AdminDocumentHead />
        <FullPageLoader message="Checking admin access…" />
      </>
    );
  }

  if (user && isAdmin) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const perf = beginAsyncInteraction('admin_login_submit');
    let outcome = 'completed';

    setLoading(true);
    try {
      perf.markNetworkStart();
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signError) {
        console.error('[AdminLogin] signInWithPassword', {
          message: signError.message,
          name: (signError as AuthError).name,
          status: (signError as AuthError).status,
          supabaseHost: supabaseHostForLog(),
        });
        setError(formatAdminAuthError(signError as AuthError));
        outcome = 'auth_error';
        return;
      }

      outcome = 'success';
      navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      const caught = err instanceof Error ? err : new Error(String(err));
      const cause = caught && 'cause' in caught && caught.cause != null ? caught.cause : undefined;
      console.error('[AdminLogin] signInWithPassword threw', caught, {
        supabaseHost: supabaseHostForLog(),
        cause,
      });
      setError(formatAdminAuthError(caught, cause));
      outcome = 'error';
    } finally {
      setLoading(false);
      perf.end(outcome);
    }
  };

  const inputClass =
    'relative z-10 block min-h-[3.25rem] w-full rounded-xl border-2 border-slate-300 bg-white py-3 text-lg text-slate-900 caret-slate-900 placeholder:text-slate-400 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';

  return (
    <>
      <AdminDocumentHead />
      <div className="relative isolate z-10 flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
        <div className="relative z-10 w-full max-w-md pb-6">
          <div className="mb-6 text-center">
            <Logo variant="admin" className="mx-auto mb-5 justify-center" />
            <Lock className="mx-auto mb-3 h-11 w-11 text-amber-600" aria-hidden />
            <h1 className="text-3xl font-bold text-slate-900">Launch Zone Admin</h1>
            <p className="mt-2 text-lg text-slate-600">Sign in with your staff email and password.</p>
          </div>

          <div className="relative z-10 rounded-2xl bg-white p-6 text-slate-900 shadow-lg sm:p-8">
            {user && !isAdmin ? (
              <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-base font-semibold text-amber-950">
                This account is signed in but is not authorized for admin. Use an admin account or sign out from
                another session.
              </div>
            ) : null}

            {error ? (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-800" role="alert">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="relative z-10 space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-base font-bold text-slate-900">
                  Email
                </label>
                <div className="relative z-10">
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 z-0 flex items-center pl-4"
                    aria-hidden
                  >
                    <Mail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`${inputClass} pl-12 pr-4`}
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-base font-bold text-slate-900">
                  Password
                </label>
                <div className="relative z-10">
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 z-0 flex items-center pl-4"
                    aria-hidden
                  >
                    <Lock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pl-12 pr-14`}
                    placeholder="Your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 z-20 flex min-w-[3rem] items-center justify-center rounded-r-xl text-slate-600 hover:text-slate-900"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="min-h-[3.25rem] w-full rounded-xl bg-amber-600 text-lg font-bold text-white transition-colors hover:bg-amber-700 disabled:bg-slate-300"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <p className="mt-6 rounded-xl bg-cyan-50 px-4 py-3 text-base leading-relaxed text-cyan-950">
              <strong>Tip:</strong> Add this page to your phone&apos;s Home Screen for one-tap access.
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <Link
                to="/"
                className="inline-flex min-h-[3rem] w-full items-center justify-center rounded-xl border-2 border-slate-300 bg-white px-4 text-base font-bold text-slate-800 hover:bg-slate-50"
              >
                Back to Main Website
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
