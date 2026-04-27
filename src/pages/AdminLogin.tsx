import { useState } from 'react';
import { Lock, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Logo from '../components/ui/Logo';
import { beginAsyncInteraction, wrapNavigateClick } from '../lib/clickPerf';

interface AdminLoginProps {
  onNavigate: (page: string) => void;
}

export default function AdminLogin({ onNavigate }: AdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        setError(signError.message);
        outcome = 'auth_error';
        return;
      }

      outcome = 'success';
      window.location.assign('/admin');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
      outcome = 'error';
    } finally {
      setLoading(false);
      perf.end(outcome);
    }
  };

  return (
    <div className="relative isolate z-10 flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 text-slate-900 sm:px-6 lg:px-8">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo variant="admin" className="mx-auto mb-6 justify-center" />
          <Lock className="mx-auto mb-4 h-12 w-12 text-amber-600" aria-hidden />
          <h1 className="text-3xl font-bold text-slate-900">Admin Login</h1>
          <p className="mt-2 text-slate-600">Sign in to access the dashboard</p>
        </div>

        <div className="relative z-10 rounded-xl bg-white p-8 text-slate-900 shadow-lg">
          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="relative z-10 space-y-6">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-semibold text-slate-900">
                Email Address
              </label>
              <div className="relative z-10">
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 z-0 flex items-center pl-3"
                  aria-hidden
                >
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="relative z-10 block w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-3 text-slate-900 caret-slate-900 placeholder:text-slate-400 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-600"
                  placeholder="admin@example.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-900">
                Password
              </label>
              <div className="relative z-10">
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 z-0 flex items-center pl-3"
                  aria-hidden
                >
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="password"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="relative z-10 block w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-3 text-slate-900 caret-slate-900 placeholder:text-slate-400 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-600"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-amber-600 py-3 font-bold text-white transition-colors hover:bg-amber-700 disabled:bg-slate-300"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={wrapNavigateClick('admin_login', 'home', onNavigate)}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
