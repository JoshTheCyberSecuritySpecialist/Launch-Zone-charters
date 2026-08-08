import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CloudSun,
  DollarSign,
  FileCheck2,
  LayoutGrid,
  Mail,
  PlusCircle,
  RefreshCw,
  Ship,
  ShipWheel,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import AdminQuickActionCard from '../components/admin/AdminQuickActionCard';
import AdminDashboardCard from '../components/admin/AdminDashboardCard';
import { useAdminQuickCounts } from '../components/admin/useAdminQuickCounts';
import { humanizeLabel } from '../components/admin/adminDisplay';
import LoadingSection from '../components/admin/LoadingSection';
import { env } from '../config/env.js';
import { adminCharterCapacityLines } from '../lib/charterCapacity';
import { withTimeout } from '../lib/adminDiagnostics';
import {
  filterActiveOpsBookingGroups,
  formatRelativeTime,
  fetchOperationsDashboard,
  markAllBookingsReviewed,
  markBookingReviewed,
  normalizeOpsFilterFromApi,
  normalizeOpsSortFromApi,
  OPS_FILTER_OPTIONS,
  OPS_SORT_OPTIONS,
  type OpsDashboardPayload,
  type OpsDashboardSort,
} from '../lib/adminOpsDashboard';
import { adminDebugLog } from '../lib/adminDiagnostics';
import AdminOpsNewBookingCard from '../components/admin/AdminOpsNewBookingCard';

type OpsBooking = {
  id: string;
  customer_name: string;
  boat_id: string | null;
  boat_name: string;
  location: string | null;
  start_time: string;
  end_time: string;
  passenger_count: number;
  payment_status: string;
  status: string;
  booking_source: string;
  booking_type?: string | null;
  waiver_done: boolean;
  insurance_done: boolean;
  license_done: boolean;
  ready_for_departure: boolean;
  outstanding: number;
};

type ActionItem = {
  booking_id: string;
  customer_name: string;
  boat_name: string;
  start_time: string;
  type: string;
  label: string;
  urgency: number;
};

type RevenueSummary = {
  bookings: number;
  revenue: number;
  deposits: number;
  outstandingBalance: number;
  averageBookingValue: number;
};

type BoatStatus = {
  id: string;
  name: string;
  type?: string | null;
  status: string;
  bookings: OpsBooking[];
};

type Activity = {
  id: string;
  booking_id?: string | null;
  event_type: string;
  message?: string | null;
  created_at: string;
};

type DashboardPayload = OpsDashboardPayload & {
  todayTrips: OpsBooking[];
  actionRequired: ActionItem[];
  schedule: { boats: BoatStatus[]; bookings: OpsBooking[] };
  boatStatus: BoatStatus[];
  revenue: { today: RevenueSummary; week: RevenueSummary; month: RevenueSummary };
  bookingSources: Record<string, number>;
  recentActivity: Activity[];
  weather?: Record<string, unknown>;
  alerts: ActionItem[];
  today?: string;
  newBookingsGrouped: OpsDashboardPayload['newBookingsGrouped'];
};

const money = (value: number | string | null | undefined) => `$${Number(value || 0).toFixed(2)}`;

const EMPTY_REVENUE: RevenueSummary = {
  bookings: 0,
  revenue: 0,
  deposits: 0,
  outstandingBalance: 0,
  averageBookingValue: 0,
};

function weatherDisplay(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** API may omit nested fields on errors or older backends — avoid render crashes. */
function normalizeDashboardPayload(data: OpsDashboardPayload): DashboardPayload {
  const raw = data as OpsDashboardPayload & Partial<DashboardPayload>;
  const revenueRaw = raw.revenue as
    | { today?: RevenueSummary; week?: RevenueSummary; month?: RevenueSummary }
    | undefined;
  return {
    ...raw,
    todayTrips: (raw.todayTrips ?? []) as DashboardPayload['todayTrips'],
    actionRequired: raw.actionRequired ?? [],
    schedule: raw.schedule ?? { boats: [], bookings: [] },
    boatStatus: raw.boatStatus ?? [],
    bookingSources: raw.bookingSources ?? {},
    alerts: raw.alerts ?? [],
    newBookingsGrouped: raw.newBookingsGrouped ?? [],
    revenue: {
      today: revenueRaw?.today ?? EMPTY_REVENUE,
      week: revenueRaw?.week ?? EMPTY_REVENUE,
      month: revenueRaw?.month ?? EMPTY_REVENUE,
    },
  };
}

function timeLabel(start: string, end?: string) {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (!Number.isFinite(s.getTime())) return '-';
  return e && Number.isFinite(e.getTime())
    ? `${s.toLocaleTimeString([], opts)} - ${e.toLocaleTimeString([], opts)}`
    : s.toLocaleTimeString([], opts);
}

function sourceLabel(value: string) {
  return String(value || 'website').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusPill(ok: boolean, label: string) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-bold ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
      {label}: {ok ? 'OK' : 'Missing'}
    </span>
  );
}

function revenueCard(title: string, row: RevenueSummary) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <h3 className="font-black text-slate-900">{title}</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><div className="text-slate-500">Bookings</div><div className="text-xl font-black">{row.bookings}</div></div>
        <div><div className="text-slate-500">Revenue</div><div className="text-xl font-black">{money(row.revenue)}</div></div>
        <div><div className="text-slate-500">Deposits</div><div className="font-bold">{money(row.deposits)}</div></div>
        <div><div className="text-slate-500">Outstanding</div><div className="font-bold text-amber-700">{money(row.outstandingBalance)}</div></div>
        <div className="col-span-2"><div className="text-slate-500">Average Booking Value</div><div className="font-bold">{money(row.averageBookingValue)}</div></div>
      </div>
    </div>
  );
}

export default function AdminOperationsDashboard() {
  const { user, isAdmin, loading: authLoading, authError, retryAuth } = useAuth();
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [opsSort, setOpsSort] = useState<OpsDashboardSort>('trip_date');
  const [opsFilter, setOpsFilter] = useState('');
  const [appliedSort, setAppliedSort] = useState<OpsDashboardSort>('trip_date');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [bookingsRefreshing, setBookingsRefreshing] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const knownNewBookingIdsRef = useRef<Set<string>>(new Set());
  const pollInFlightRef = useRef(false);
  const opsSortRef = useRef(opsSort);
  const opsFilterRef = useRef(opsFilter);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const fetchGenerationRef = useRef(0);
  const hasPayloadRef = useRef(false);
  const queryEffectMountedRef = useRef(false);
  const POLL_MS = 45_000;

  opsSortRef.current = opsSort;
  opsFilterRef.current = opsFilter;
  hasPayloadRef.current = payload != null;

  const queryMatchesApplied =
    opsSort === appliedSort && opsFilter === appliedFilter;

  const getAdminToken = useCallback(async () => {
    const { data } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return data.session?.access_token || null;
  }, []);

  const loadDashboard = useCallback(async (options?: { background?: boolean }) => {
    if (!isAdmin) {
      setLoading(false);
      setBookingsRefreshing(false);
      return;
    }

    const sort = opsSortRef.current;
    const filter = opsFilterRef.current;
    const generation = fetchGenerationRef.current + 1;
    fetchGenerationRef.current = generation;

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    if (!options?.background && !hasPayloadRef.current) {
      setLoading(true);
    }
    setBookingsRefreshing(true);
    setBookingsError(null);

    if (import.meta.env.DEV) {
      adminDebugLog('ops-dashboard:fetch', { sort, filter: filter || '(all new)', generation });
    }

    try {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      const data = await fetchOperationsDashboard(
        token,
        {
          sort,
          filter: filter || undefined,
        },
        { signal: controller.signal }
      );

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      const prevKnown = knownNewBookingIdsRef.current;
      const incomingNew = (data.newBookings || []).map((b) => b.id);
      if (prevKnown.size > 0) {
        const fresh = incomingNew.filter((id) => !prevKnown.has(id));
        if (fresh.length > 0) {
          setLiveNotice(
            fresh.length === 1 ? '1 new booking arrived' : `${fresh.length} new bookings arrived`
          );
        }
      }
      knownNewBookingIdsRef.current = new Set(incomingNew);
      setPayload(normalizeDashboardPayload(data));
      setLastFetchedAt(Date.now());
      setAppliedSort(normalizeOpsSortFromApi(data.sort));
      setAppliedFilter(normalizeOpsFilterFromApi(data.filter));
      setBookingsError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (generation !== fetchGenerationRef.current) {
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Could not load operations dashboard.';
      setBookingsError("Couldn't load bookings. Try again.");
      if (!hasPayloadRef.current) {
        setNotice(message);
      }
      if (import.meta.env.DEV) {
        adminDebugLog('ops-dashboard:fetch-failed', {
          sort,
          filter: filter || '(all new)',
          message,
        });
      }
    } finally {
      if (generation === fetchGenerationRef.current) {
        setLoading(false);
        setBookingsRefreshing(false);
      }
    }
  }, [getAdminToken, isAdmin]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadDashboard();
  }, [authLoading, isAdmin, loadDashboard]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    if (!queryEffectMountedRef.current) {
      queryEffectMountedRef.current = true;
      return;
    }
    void loadDashboard({ background: hasPayloadRef.current });
  }, [opsSort, opsFilter, authLoading, isAdmin, loadDashboard]);

  useEffect(
    () => () => {
      fetchAbortRef.current?.abort();
    },
    []
  );

  const { counts: headCounts, countsLoading, reloadCounts } = useAdminQuickCounts(isAdmin && !authLoading);
  const lastBackgroundRefreshRef = useRef(0);
  const BACKGROUND_REFRESH_MS = 60_000;

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    const refreshIfStale = () => {
      const now = Date.now();
      if (now - lastBackgroundRefreshRef.current < BACKGROUND_REFRESH_MS) return;
      lastBackgroundRefreshRef.current = now;
      void loadDashboard();
      void reloadCounts();
    };
    window.addEventListener('focus', refreshIfStale);
    return () => window.removeEventListener('focus', refreshIfStale);
  }, [authLoading, isAdmin, loadDashboard, reloadCounts]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let timer: number | undefined;
    const tick = () => {
      if (document.hidden || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      void loadDashboard({ background: true }).finally(() => {
        pollInFlightRef.current = false;
      });
    };
    const schedule = () => {
      window.clearInterval(timer);
      timer = window.setInterval(tick, POLL_MS);
    };
    const onVisibility = () => {
      if (!document.hidden) {
        tick();
        schedule();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authLoading, isAdmin, loadDashboard]);

  useEffect(() => {
    if (!liveNotice) return;
    const t = window.setTimeout(() => setLiveNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [liveNotice]);

  const handleMarkReviewed = useCallback(
    async (bookingId: string) => {
      try {
        const token = await getAdminToken();
        if (!token) throw new Error('Admin session expired.');
        await markBookingReviewed(token, bookingId);
        knownNewBookingIdsRef.current.delete(bookingId);
        await loadDashboard();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Could not mark reviewed.');
      }
    },
    [getAdminToken, loadDashboard]
  );

  const handleMarkAllReviewed = useCallback(async () => {
    if (!window.confirm('Mark all current new bookings as reviewed?')) return;
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      await markAllBookingsReviewed(token);
      knownNewBookingIdsRef.current = new Set();
      await loadDashboard();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not mark all reviewed.');
    }
  }, [getAdminToken, loadDashboard]);

  const todayTrips = useMemo(() => payload?.todayTrips ?? [], [payload?.todayTrips]);
  const actionRequired = payload?.actionRequired || [];

  const nextTrip = useMemo(() => {
    if (todayTrips.length === 0) return null;
    const now = Date.now();
    const sorted = [...todayTrips].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
    return sorted.find((t) => new Date(t.start_time).getTime() >= now) || sorted[0];
  }, [todayTrips]);

  const paperworkMissing = useMemo(
    () =>
      todayTrips.filter(
        (t) => !(t as OpsBooking).waiver_done || !(t as OpsBooking).insurance_done || !(t as OpsBooking).license_done
      ).length,
    [todayTrips]
  );

  const refreshHeaderAction = (
    <button
      type="button"
      onClick={() => {
        void loadDashboard();
        void reloadCounts(true);
      }}
      disabled={loading}
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
      aria-label={loading ? 'Refreshing' : 'Refresh dashboard'}
    >
      <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
    </button>
  );

  const sourceRows = useMemo(() => Object.entries(payload?.bookingSources || {}).sort((a, b) => b[1] - a[1]), [payload]);

  if (authLoading) {
    return <FullPageLoader message="Checking admin access…" />;
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
          <h1 className="text-2xl font-bold text-slate-900">Admin session could not load</h1>
          <p className="mt-2 text-slate-600">
            The admin page stopped while restoring your browser session.
          </p>
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-left text-sm font-semibold text-red-800">
            {authError}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={retryAuth}
              className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-white hover:bg-amber-700"
            >
              Retry
            </button>
            <Link
              to="/admin-login"
              className="rounded-lg bg-slate-200 px-6 py-3 font-bold text-slate-900 hover:bg-slate-300"
            >
              Admin Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }

  if (loading && !payload) {
    return (
      <AdminShell
        title="Operations Dashboard"
        mobileTitle="Operations"
        subtitle="Launch Zone Admin"
        hideSubtitleOnMobile
        headerActions={refreshHeaderAction}
      >
        <LoadingSection message="Loading operations dashboard…" />
      </AdminShell>
    );
  }

  if (!payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg rounded-xl bg-white p-8 text-center shadow-lg">
          <h1 className="text-2xl font-bold text-slate-900">Operations dashboard could not load</h1>
          <p className="mt-2 text-slate-600">
            The request failed or timed out. This can happen on mobile networks. Other admin pages
            like Bookings may still work.
          </p>
          {notice ? (
            <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-left text-sm font-semibold text-red-800">
              {notice}
            </div>
          ) : null}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-white hover:bg-amber-700"
            >
              Retry dashboard
            </button>
            <Link
              to="/admin/bookings"
              className="rounded-lg bg-slate-200 px-6 py-3 font-bold text-slate-900 hover:bg-slate-300"
            >
              Open Bookings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const weather = payload.weather || {};
  const dashboardCounts = payload.counts;
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const updatedLabel =
    lastFetchedAt != null ? formatRelativeTime(new Date(lastFetchedAt).toISOString()) : '';

  const activeNewBookingGroups = filterActiveOpsBookingGroups(payload.newBookingsGrouped || []);

  const actionCenterItems = [
    {
      key: 'new',
      count: dashboardCounts?.newBookings ?? 0,
      label: 'New bookings',
      hint: 'Since your last review',
      to: '#ops-new-bookings',
      urgent: (dashboardCounts?.newBookings ?? 0) > 0,
    },
    {
      key: 'approvals',
      count: dashboardCounts?.pendingApprovals ?? 0,
      label: 'Pending approvals',
      hint: 'Bookings & pre-trip',
      to: '/admin/approvals',
      urgent: (dashboardCounts?.pendingApprovals ?? 0) > 0,
    },
    {
      key: 'groupon',
      count: dashboardCounts?.grouponPending ?? 0,
      label: 'Groupon to review',
      hint: 'Voucher requests',
      to: '/admin/approvals',
      urgent: (dashboardCounts?.grouponPending ?? 0) > 0,
    },
    {
      key: 'waivers',
      count: dashboardCounts?.pendingWaivers ?? 0,
      label: 'Waivers needed',
      hint: 'Upcoming trips',
      to: '/admin/approvals',
      urgent: (dashboardCounts?.pendingWaivers ?? 0) > 0,
    },
    {
      key: 'messages',
      count: dashboardCounts?.unreadMessages ?? 0,
      label: 'Unread messages',
      hint: 'Contact inbox',
      to: '/admin/messages',
      urgent: (dashboardCounts?.unreadMessages ?? 0) > 0,
    },
    {
      key: 'conflicts',
      count: dashboardCounts?.conflicts ?? 0,
      label: 'Schedule warnings',
      hint: 'Possible conflicts',
      to: '#ops-conflicts',
      urgent: (dashboardCounts?.conflicts ?? 0) > 0,
    },
  ].filter((item) => item.count > 0 || item.key === 'new');

  return (
    <AdminShell
      title="Operations Dashboard"
      mobileTitle="Operations"
      subtitle={todayLabel}
      hideSubtitleOnMobile={false}
      headerActions={
        <div className="flex items-center gap-2">
          <Link
            to="/admin/messages"
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700"
            aria-label={`Messages${dashboardCounts?.unreadMessages ? `, ${dashboardCounts.unreadMessages} unread` : ''}`}
          >
            <Bell className="h-5 w-5 text-white" aria-hidden />
            {(dashboardCounts?.unreadMessages ?? 0) > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {dashboardCounts!.unreadMessages > 9 ? '9+' : dashboardCounts!.unreadMessages}
              </span>
            ) : null}
          </Link>
          {refreshHeaderAction}
        </div>
      }
      actions={
        <button
          type="button"
          onClick={() => {
            void loadDashboard();
            void reloadCounts(true);
          }}
          disabled={loading}
          className="min-h-11 rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      <div className="max-w-full space-y-5 overflow-x-hidden pb-[max(5rem,env(safe-area-inset-bottom))] lg:space-y-6">
        {notice ? <div className="rounded-lg bg-red-100 px-4 py-3 font-semibold text-red-800">{notice}</div> : null}
        <div
          className="rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm text-cyan-950"
          aria-live="polite"
        >
          <span className="font-semibold">Polling updates</span>
          {updatedLabel ? ` · Updated ${updatedLabel}` : null}
          {liveNotice ? ` · ${liveNotice}` : null}
        </div>

        <section aria-labelledby="ops-action-center">
          <h2 id="ops-action-center" className="text-lg font-black text-slate-900">
            Action center
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
            {actionCenterItems.map((item) => (
              <Link
                key={item.key}
                to={item.to.startsWith('#') ? `/admin${item.to}` : item.to}
                className={`flex min-h-[72px] flex-col justify-center rounded-2xl border px-4 py-3 ${
                  item.urgent ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
                }`}
              >
                <span className="text-2xl font-black text-slate-900">{item.count}</span>
                <span className="text-sm font-bold text-slate-800">{item.label}</span>
                <span className="text-xs text-slate-600">{item.hint}</span>
              </Link>
            ))}
          </div>
        </section>

        <section id="ops-new-bookings" aria-labelledby="ops-new-bookings-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="ops-new-bookings-heading" className="text-lg font-black text-slate-900">
              New bookings
            </h2>
            {(payload.newBookings?.length ?? 0) > 0 ? (
              <button
                type="button"
                onClick={() => void handleMarkAllReviewed()}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
              >
                Mark all reviewed
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-h-11 flex-1 items-center gap-2 text-sm font-semibold text-slate-800">
              Sort
              <select
                value={opsSort}
                onChange={(e) =>
                  setOpsSort(e.target.value as OpsDashboardSort)
                }
                className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {OPS_SORT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            {OPS_FILTER_OPTIONS.map((f) => {
              const active = opsFilter === f.id && queryMatchesApplied;
              const pending = opsFilter === f.id && !queryMatchesApplied && bookingsRefreshing;
              return (
                <button
                  key={f.id || 'all'}
                  type="button"
                  onClick={() => setOpsFilter(f.id)}
                  aria-pressed={opsFilter === f.id}
                  className={`shrink-0 min-h-11 rounded-full px-4 py-2 text-sm font-semibold touch-manipulation ${
                    active
                      ? 'bg-slate-900 text-white'
                      : pending
                        ? 'border border-slate-900 bg-slate-100 text-slate-900'
                        : 'border border-slate-300 bg-white text-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {bookingsError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950">
              <p className="font-semibold">{bookingsError}</p>
              <button
                type="button"
                onClick={() => void loadDashboard({ background: hasPayloadRef.current })}
                className="mt-2 min-h-11 rounded-lg bg-red-900 px-4 py-2 text-sm font-bold text-white"
              >
                Retry
              </button>
            </div>
          ) : null}

          <div className="relative mt-4 space-y-6" aria-busy={bookingsRefreshing}>
            {bookingsRefreshing && !queryMatchesApplied ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-base font-semibold text-slate-700">
                Refreshing bookings…
              </p>
            ) : null}
            {!bookingsRefreshing && queryMatchesApplied && activeNewBookingGroups.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-base text-slate-600">
                No new bookings match this filter.
              </p>
            ) : null}
            {queryMatchesApplied && activeNewBookingGroups.length > 0
              ? activeNewBookingGroups.map((group) => (
                  <div key={group.groupKey}>
                    <header className="border-b border-slate-200 pb-2">
                      {group.headerRelative ? (
                        <p className="text-sm font-black tracking-wide text-amber-800">{group.headerRelative}</p>
                      ) : group.groupKey === 'needs-review' ? (
                        <p className="text-sm font-black text-red-800">NEEDS SCHEDULING REVIEW</p>
                      ) : (
                        <p className="text-sm font-black text-slate-600">LATER</p>
                      )}
                      <p className="text-base font-bold text-slate-900">{group.headerDate}</p>
                    </header>
                    <div className="mt-3 space-y-3">
                      {group.bookings.map((booking) => (
                        <AdminOpsNewBookingCard
                          key={booking.id}
                          booking={booking}
                          onMarkReviewed={(id) => void handleMarkReviewed(id)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              : null}
            {bookingsRefreshing && queryMatchesApplied ? (
              <p className="text-center text-sm font-semibold text-slate-500">Refreshing bookings…</p>
            ) : null}
          </div>
        </section>

        {(payload.conflicts?.length ?? 0) > 0 ? (
          <section id="ops-conflicts" aria-labelledby="ops-conflicts-heading">
            <h2 id="ops-conflicts-heading" className="text-lg font-black text-red-900">
              Schedule warnings
            </h2>
            <ul className="mt-3 space-y-2">
              {payload.conflicts!.slice(0, 8).map((c) => (
                <li key={`${c.type}-${c.booking_id}-${c.other_booking_id || ''}`}>
                  <Link
                    to={`/admin/bookings/${c.booking_id}`}
                    className="block min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-950"
                  >
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {payload.upcoming ? (
          <section aria-labelledby="ops-upcoming-heading">
            <h2 id="ops-upcoming-heading" className="text-lg font-black text-slate-900">
              Upcoming
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['Today', payload.upcoming.today, 'today'],
                  ['Tomorrow', payload.upcoming.tomorrow, 'tomorrow'],
                  ['Weekend', payload.upcoming.weekend, 'weekend'],
                  ['Next 7 days', payload.upcoming.nextSevenDays, 'week'],
                ] as const
              ).map(([label, n]) => (
                <Link
                  key={label}
                  to="/admin/calendar"
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-3 text-center"
                >
                  <div className="text-xl font-black text-slate-900">{n}</div>
                  <div className="text-xs font-semibold text-slate-600">{label}</div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* ——— Compact mobile command dashboard ——— */}
        <section className="space-y-5">
          <article className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-slate-900">Today&apos;s Operations</h2>
                <p className="mt-1 text-base text-slate-700">
                  <span className="font-bold">{todayTrips.length}</span> trip{todayTrips.length === 1 ? '' : 's'} today
                </p>
              </div>
              {actionRequired.length > 0 ? (
                <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800">
                  {actionRequired.length} urgent
                </span>
              ) : null}
            </div>
            {nextTrip ? (
              <dl className="mt-4 space-y-1 text-base text-slate-800">
                <div>
                  <dt className="inline font-semibold text-slate-600">Next trip: </dt>
                  <dd className="inline">{timeLabel(nextTrip.start_time, nextTrip.end_time)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-slate-600">Customer: </dt>
                  <dd className="inline">{nextTrip.customer_name}</dd>
                </div>
                {nextTrip.booking_type === 'charter' ? (
                  <div>
                    <dt className="inline font-semibold text-slate-600">Guests: </dt>
                    <dd className="inline">{nextTrip.passenger_count}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="mt-4 text-base text-slate-600">No departures scheduled today.</p>
            )}
            {paperworkMissing > 0 ? (
              <p className="mt-3 text-base font-semibold text-amber-900">
                {paperworkMissing} trip{paperworkMissing === 1 ? '' : 's'} missing paperwork
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href="#mobile-today-detail"
                onClick={() => {
                  const el = document.getElementById('mobile-today-detail');
                  if (el instanceof HTMLDetailsElement) el.open = true;
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-3 text-center text-sm font-bold text-white lg:hidden"
              >
                View Trips
              </a>
              <Link
                to="/admin/calendar"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-center text-sm font-bold text-slate-900"
              >
                Calendar
              </Link>
              <a
                href="#today-trips"
                className="hidden min-h-11 items-center justify-center rounded-xl bg-slate-900 px-3 text-center text-sm font-bold text-white lg:inline-flex"
              >
                View Trips
              </a>
            </div>
          </article>

          <div>
            <h2 className="text-lg font-black text-slate-900">Quick Actions</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 min-[350px]:grid-cols-2">
              <AdminQuickActionCard
                to="/admin/staff-booking"
                title="New Booking"
                description="Create a reservation"
                icon={<PlusCircle className="h-5 w-5" />}
              />
              <AdminQuickActionCard
                to="/admin/messages"
                title="Messages"
                description={
                  countsLoading
                    ? 'Loading…'
                    : (dashboardCounts?.unreadMessages ?? headCounts.unreadMessages) > 0
                      ? `${dashboardCounts?.unreadMessages ?? headCounts.unreadMessages} unread`
                      : 'Contact inbox'
                }
                icon={<Mail className="h-5 w-5" />}
                badge={
                  (dashboardCounts?.unreadMessages ?? headCounts.unreadMessages) > 0
                    ? String(dashboardCounts?.unreadMessages ?? headCounts.unreadMessages)
                    : null
                }
                highlight={(dashboardCounts?.unreadMessages ?? headCounts.unreadMessages) > 0}
              />
              <AdminQuickActionCard
                to="/admin/approvals"
                title="Approvals"
                description={
                  countsLoading
                    ? 'Loading…'
                    : (dashboardCounts?.pendingApprovals ?? headCounts.pendingApprovals) > 0
                      ? `${dashboardCounts?.pendingApprovals ?? headCounts.pendingApprovals} need review`
                      : 'All clear'
                }
                icon={<FileCheck2 className="h-5 w-5" />}
                badge={
                  (dashboardCounts?.pendingApprovals ?? headCounts.pendingApprovals) > 0
                    ? String(dashboardCounts?.pendingApprovals ?? headCounts.pendingApprovals)
                    : null
                }
                highlight={(dashboardCounts?.pendingApprovals ?? headCounts.pendingApprovals) > 0}
              />
              <AdminQuickActionCard
                to="/admin/calendar"
                title="Calendar"
                description="View schedule"
                icon={<CalendarDays className="h-5 w-5" />}
              />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-black text-slate-900">Bookings</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 min-[350px]:grid-cols-2">
              <AdminQuickActionCard
                to="/admin/bookings/list"
                title="All Bookings"
                description="Search every reservation"
                icon={<Ship className="h-5 w-5" />}
              />
              <AdminQuickActionCard
                to="/admin/staff-booking"
                title="Staff Booking"
                description="Book for a customer"
                icon={<PlusCircle className="h-5 w-5" />}
              />
            </div>
          </div>

          <AdminDashboardCard
            to="/admin/more"
            title="More Tools"
            description="Outbox, disputes, shop, promo codes, and more"
            icon={<LayoutGrid className="h-6 w-6" />}
            status="Open menu"
          />
        </section>

        {/* Mobile: expandable today detail */}
        <details id="mobile-today-detail" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:hidden">
          <summary className="cursor-pointer text-lg font-black text-slate-900">
            Today&apos;s trips &amp; schedule
          </summary>
          <div className="mt-4 space-y-4">
            {todayTrips.length === 0 ? (
              <p className="text-slate-600">No departures today.</p>
            ) : (
              todayTrips.map((trip) => (
                <Link
                  key={trip.id}
                  to={`/admin/bookings/${trip.id}`}
                  className="block rounded-xl border border-slate-200 p-4 hover:border-amber-300"
                >
                  <div className="font-bold text-slate-900">{trip.customer_name}</div>
                  <div className="text-sm text-slate-600">
                    {timeLabel(trip.start_time, trip.end_time)} · {trip.boat_name}
                  </div>
                </Link>
              ))
            )}
            {actionRequired.length > 0 ? (
              <div>
                <h3 className="font-bold text-red-800">Needs attention</h3>
                <ul className="mt-2 space-y-2">
                  {actionRequired.slice(0, 6).map((item) => (
                    <li key={`${item.booking_id}-${item.type}`}>
                      <Link
                        to={`/admin/bookings/${item.booking_id}`}
                        className="block rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-900"
                      >
                        {item.label} — {item.customer_name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>

        {/* ——— Full ops detail (desktop) ——— */}
        <div className="hidden space-y-6 lg:block">
          <div id="today-trips" className="rounded-2xl bg-white p-5 shadow">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-600" />
              <h2 className="text-2xl font-black">Today&apos;s Trips</h2>
            </div>
            <div className="mt-4 grid gap-3">
              {(payload?.todayTrips || []).length === 0 ? (
                <p className="text-slate-500">No departures today.</p>
              ) : (
                payload!.todayTrips.map((trip) => (
                  <Link key={trip.id} to={`/admin/bookings/${trip.id}`} className="rounded-xl border border-slate-200 p-4 transition hover:border-amber-300 hover:bg-amber-50">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-black">{trip.customer_name}</h3>
                        <p className="text-sm text-slate-600">{trip.boat_name} · {trip.location || 'No location'} · {timeLabel(trip.start_time, trip.end_time)}</p>
                        {trip.booking_type === 'charter' ? (
                          <div className="mt-1 text-sm text-slate-600">
                            {(() => {
                              const lines = adminCharterCapacityLines(trip.passenger_count);
                              return (
                                <>
                                  <div>{lines.passengerLine}</div>
                                  <div>{lines.captainLine}</div>
                                  <div>{lines.totalLine}</div>
                                </>
                              );
                            })()}
                            <div className="mt-1">{sourceLabel(trip.booking_source)}</div>
                          </div>
                        ) : (
                          <p className="text-sm text-slate-600">{trip.passenger_count} passengers · {sourceLabel(trip.booking_source)}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize">
                          {String(trip.payment_status || 'pending').replace(/_/g, ' ')}
                        </span>
                        {statusPill(Boolean(trip.waiver_done), 'Waiver')}
                        {statusPill(Boolean(trip.insurance_done), 'Insurance')}
                        {statusPill(Boolean(trip.license_done), 'License')}
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${trip.ready_for_departure ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                          Ready: {trip.ready_for_departure ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <h2 className="text-2xl font-black">Action Required</h2>
            </div>
            <div className="mt-4 space-y-2">
              {(payload?.actionRequired || []).slice(0, 12).map((item) => (
                <Link key={`${item.booking_id}-${item.type}`} to={`/admin/bookings/${item.booking_id}`} className="block rounded-lg border border-slate-200 p-3 hover:bg-red-50">
                  <div className="font-black">{item.label}</div>
                  <div className="text-sm text-slate-600">{item.customer_name} · {item.boat_name} · {timeLabel(item.start_time)}</div>
                </Link>
              ))}
              {(payload?.actionRequired || []).length === 0 ? <p className="text-slate-500">Nothing needs attention.</p> : null}
            </div>
          </div>

        <section className="rounded-2xl bg-white p-5 shadow">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-cyan-700" />
            <h2 className="text-2xl font-black">Today&apos;s Schedule</h2>
          </div>
          <div className="mt-4">
            {(payload?.schedule?.boats || []).length === 0 ? (
              <p className="text-slate-500">No boats scheduled.</p>
            ) : (
              <AdminResponsiveList
                desktop={
                  <div className="overflow-x-auto">
                    <div className="min-w-[760px] space-y-3">
                      {(payload?.schedule?.boats || []).map((boat) => (
                        <div key={boat.id} className="grid grid-cols-[160px_1fr] items-stretch gap-3">
                          <div className="rounded-lg bg-slate-100 p-3 font-black">{boat.name}</div>
                          <div className="flex min-h-[56px] gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                            {boat.bookings.length === 0 ? (
                              <span className="self-center text-sm text-slate-500">Open all day</span>
                            ) : (
                              boat.bookings.map((booking) => (
                                <Link
                                  key={booking.id}
                                  to={`/admin/bookings/${booking.id}`}
                                  className="min-w-[180px] rounded-lg bg-blue-100 px-3 py-2 text-sm font-bold text-blue-950"
                                >
                                  {timeLabel(booking.start_time, booking.end_time)}
                                  <br />
                                  {booking.customer_name}
                                </Link>
                              ))
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                }
                mobile={
                  <div className="space-y-3">
                    {(payload?.schedule?.boats || []).map((boat) => (
                      <article key={boat.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-base font-black text-slate-900">{boat.name}</h3>
                          <span className="text-xs font-semibold text-slate-500">
                            {boat.bookings.length === 0
                              ? 'Open'
                              : `${boat.bookings.length} trip${boat.bookings.length === 1 ? '' : 's'}`}
                          </span>
                        </div>
                        {boat.bookings.length === 0 ? (
                          <p className="mt-3 text-sm text-slate-500">Open all day</p>
                        ) : (
                          <ul className="mt-3 space-y-2">
                            {boat.bookings.map((booking) => (
                              <li key={booking.id}>
                                <Link
                                  to={`/admin/bookings/${booking.id}`}
                                  className="block rounded-lg bg-blue-100 px-3 py-3 text-sm font-bold text-blue-950"
                                >
                                  <div>{timeLabel(booking.start_time, booking.end_time)}</div>
                                  <div className="mt-0.5">{booking.customer_name}</div>
                                  <div className="mt-0.5 text-xs font-semibold text-blue-900/80">
                                    {humanizeLabel(booking.status)} · {humanizeLabel(booking.payment_status)}
                                  </div>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))}
                  </div>
                }
              />
            )}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow">
            <div className="flex items-center gap-2">
              <ShipWheel className="h-5 w-5 text-blue-700" />
              <h2 className="text-2xl font-black">Boat Status</h2>
            </div>
            <div className="mt-4 grid gap-2">
              {(payload?.boatStatus || []).map((boat) => (
                <div key={boat.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                  <span className="font-bold">{boat.name}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${
                    boat.status === 'Available' ? 'bg-green-100 text-green-800' :
                    boat.status === 'In Use' ? 'bg-blue-100 text-blue-800' :
                    boat.status === 'Booked' ? 'bg-amber-100 text-amber-800' :
                    boat.status === 'Blocked' ? 'bg-slate-200 text-slate-800' :
                    'bg-red-100 text-red-800'
                  }`}>{boat.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 grid gap-5 md:grid-cols-3">
            {payload?.revenue ? revenueCard('Today', payload.revenue.today) : null}
            {payload?.revenue ? revenueCard('This Week', payload.revenue.week) : null}
            {payload?.revenue ? revenueCard('This Month', payload.revenue.month) : null}
          </div>
          <p className="text-sm text-slate-600 lg:col-span-3">
            <Link to="/admin/analytics" className="font-semibold text-amber-800 underline">
              View lifetime analytics
            </Link>
          </p>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-2xl font-black">Booking Sources</h2>
            <div className="mt-4 space-y-2">
              {sourceRows.length === 0 ? <p className="text-slate-500">No source data yet.</p> : null}
              {sourceRows.map(([source, count]) => (
                <div key={source} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2">
                  <span className="font-bold">{sourceLabel(source)}</span>
                  <span className="text-lg font-black">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <div className="flex items-center gap-2">
              <CloudSun className="h-5 w-5 text-sky-700" />
              <h2 className="text-2xl font-black">Weather Snapshot</h2>
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              <div>
                <span className="font-bold">Conditions:</span>{' '}
                {weatherDisplay(weather.status) ||
                  weatherDisplay(weather.shortForecast) ||
                  weatherDisplay(weather.error) ||
                  'Unavailable'}
              </div>
              <div><span className="font-bold">Wind:</span> {weather.windSpeed != null ? `${Math.round(Number(weather.windSpeed))} mph ${weather.windDirection || ''}` : 'Unavailable'}</div>
              <div><span className="font-bold">Temperature:</span> {weather.airTempF != null ? `${Math.round(Number(weather.airTempF))}°F` : 'Unavailable'}</div>
              <div><span className="font-bold">Wave Height:</span> {weather.waveHeightFt != null ? `${Number(weather.waveHeightFt).toFixed(1)} ft` : 'Unavailable'}</div>
              <div>
                <span className="font-bold">Rain Chance:</span>{' '}
                {weatherDisplay(
                  Array.isArray(weather.forecastPeriods) ? weather.forecastPeriods[0]?.shortForecast : null
                ) ||
                  weatherDisplay(weather.shortForecast) ||
                  'Unavailable'}
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-2xl font-black">Alerts</h2>
            <div className="mt-4 space-y-2">
              {(payload?.alerts || []).slice(0, 8).map((alert) => (
                <Link key={`${alert.booking_id}-${alert.type}-alert`} to={`/admin/bookings/${alert.booking_id}`} className="block rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-900">
                  {alert.label}: {alert.customer_name}
                </Link>
              ))}
              {(payload?.alerts || []).length === 0 ? <p className="text-slate-500">No urgent alerts.</p> : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-700" />
            <h2 className="text-2xl font-black">Recent Activity</h2>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {(payload?.recentActivity || []).slice(0, 16).map((event) => (
              <Link key={event.id} to={event.booking_id ? `/admin/bookings/${event.booking_id}` : '/admin/bookings'} className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                <div className="font-bold">{humanizeLabel(event.event_type)}</div>
                <div className="text-sm text-slate-600">{event.message || 'Booking activity'}</div>
                <div className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</div>
              </Link>
            ))}
          </div>
        </section>
        </div>
      </div>
    </AdminShell>
  );
}
