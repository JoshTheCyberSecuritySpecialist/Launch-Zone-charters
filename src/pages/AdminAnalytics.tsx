import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, DollarSign, Settings, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import { withTimeout } from '../lib/adminDiagnostics';

export default function AdminAnalytics() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [stats, setStats] = useState({
    totalBookings: 0,
    pendingBookings: 0,
    revenue: 0,
    customers: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ count: totalAll }, { count: pendingCt }, { data: priceRows }, { count: customerCt }] =
        await withTimeout(
          'Admin analytics stats',
          Promise.all([
            supabase.from('bookings').select('*', { count: 'exact', head: true }),
            supabase
              .from('bookings')
              .select('*', { count: 'exact', head: true })
              .in('status', ['pending', 'pending_verification']),
            supabase.from('bookings').select('total_price').limit(5000),
            supabase.from('customers').select('*', { count: 'exact', head: true }),
          ]),
          20000
        );

      const revenue =
        priceRows?.reduce((sum, row) => sum + parseFloat(String(row.total_price || 0)), 0) ?? 0;

      setStats({
        totalBookings: totalAll ?? 0,
        pendingBookings: pendingCt ?? 0,
        revenue,
        customers: customerCt ?? totalAll ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadStats();
  }, [isAdmin, loadStats]);

  if (authLoading) {
    return <FullPageLoader message="Checking admin access…" />;
  }

  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }

  return (
    <AdminShell
      title="Analytics"
      subtitle="Lifetime totals — for day-to-day work use Operations Dashboard"
      actions={
        <Link
          to="/admin"
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800"
        >
          Operations
        </Link>
      }
    >
      {error ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
          {error}{' '}
          <button type="button" className="underline" onClick={() => void loadStats()}>
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-slate-600">Loading analytics…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-white p-6 shadow">
            <div className="mb-3 flex items-center justify-between">
              <Calendar className="h-8 w-8 text-blue-600" aria-hidden />
              <span className="text-3xl font-bold text-slate-900">{stats.totalBookings}</span>
            </div>
            <div className="text-sm font-semibold text-slate-600">Total Bookings</div>
          </div>
          <div className="rounded-xl bg-white p-6 shadow">
            <div className="mb-3 flex items-center justify-between">
              <Settings className="h-8 w-8 text-amber-600" aria-hidden />
              <span className="text-3xl font-bold text-slate-900">{stats.pendingBookings}</span>
            </div>
            <div className="text-sm font-semibold text-slate-600">Pending Approval</div>
          </div>
          <div className="rounded-xl bg-white p-6 shadow">
            <div className="mb-3 flex items-center justify-between">
              <DollarSign className="h-8 w-8 text-green-600" aria-hidden />
              <span className="text-3xl font-bold text-slate-900">
                ${stats.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="text-sm font-semibold text-slate-600">Total Revenue (est.)</div>
            <p className="mt-2 text-xs text-slate-500">From up to 5,000 booking rows; not accounting-grade.</p>
          </div>
          <div className="rounded-xl bg-white p-6 shadow">
            <div className="mb-3 flex items-center justify-between">
              <Users className="h-8 w-8 text-purple-600" aria-hidden />
              <span className="text-3xl font-bold text-slate-900">{stats.customers}</span>
            </div>
            <div className="text-sm font-semibold text-slate-600">Customers</div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
