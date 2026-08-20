import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  CalendarDays,
  FileCheck2,
  LayoutGrid,
  Mail,
  PlusCircle,
  RefreshCw,
  Ship,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminQuickActionCard from '../components/admin/AdminQuickActionCard';
import AdminDashboardCard from '../components/admin/AdminDashboardCard';
import { useAdminQuickCounts } from '../components/admin/useAdminQuickCounts';
import LoadingSection from '../components/admin/LoadingSection';
import { env } from '../config/env.js';
import { withTimeout } from '../lib/adminDiagnostics';
import { EMPTY_OPS_REVENUE } from '../lib/adminOpsDisplay';
import {
  filterActiveOpsBookingGroups,
  formatRelativeTime,
  fetchOperationsDashboard,
  fetchOperationsDashboardDelta,
  mergeOperationsDashboardDelta,
  markAllBookingsReviewed,
  markBookingReviewed,
  normalizeOpsFilterFromApi,
  normalizeOpsSortFromApi,
  type OpsDashboardPayload,
  type OpsDashboardSort,
} from '../lib/adminOpsDashboard';
import { adminDebugLog } from '../lib/adminDiagnostics';
import AdminOpsActionCenter from '../components/admin/AdminOpsActionCenter';
import AdminOpsConflictsSection from '../components/admin/AdminOpsConflictsSection';
import AdminOpsNewBookingsSection from '../components/admin/AdminOpsNewBookingsSection';
import AdminOpsUpcomingSection from '../components/admin/AdminOpsUpcomingSection';
import {
  AdminOpsTodayDesktopPanel,
  AdminOpsTodayMobileDetail,
  AdminOpsTodaySummary,
} from '../components/admin/AdminOpsTodaySection';
import AdminOpsScheduleSection from '../components/admin/AdminOpsScheduleSection';
import AdminOpsFleetRevenueSection from '../components/admin/AdminOpsFleetRevenueSection';
import AdminOpsInsightsSection from '../components/admin/AdminOpsInsightsSection';
import AdminOpsRecentActivitySection from '../components/admin/AdminOpsRecentActivitySection';

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

function dashboardPayloadSignature(data: OpsDashboardPayload): string {
  const newIds = (data.newBookings || []).map((b) => b.id).join(',');
  const todayIds = (data.todayTrips || []).map((b) => b.id).join(',');
  const conflictCount = (data.conflicts || []).length;
  const counts = data.counts;
  return [
    newIds,
    todayIds,
    conflictCount,
    counts?.newBookings ?? 0,
    counts?.pendingApprovals ?? 0,
    counts?.conflicts ?? 0,
    counts?.unreadMessages ?? 0,
    counts?.grouponPending ?? 0,
  ].join('|');
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
      today: revenueRaw?.today ?? EMPTY_OPS_REVENUE,
      week: revenueRaw?.week ?? EMPTY_OPS_REVENUE,
      month: revenueRaw?.month ?? EMPTY_OPS_REVENUE,
    },
  };
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
  const payloadSignatureRef = useRef('');
  const lastPollSinceRef = useRef<string | null>(null);
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
      const normalized = normalizeDashboardPayload(data);
      const signature = dashboardPayloadSignature(data);
      if (signature !== payloadSignatureRef.current) {
        payloadSignatureRef.current = signature;
        setPayload(normalized);
      }
      lastPollSinceRef.current = data.generatedAt;
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

  const pollDashboardDelta = useCallback(async () => {
    if (!isAdmin) return;
    const since = lastPollSinceRef.current;
    if (!since || !hasPayloadRef.current) {
      return loadDashboard({ background: true });
    }

    const sort = opsSortRef.current;
    const filter = opsFilterRef.current;
    const generation = fetchGenerationRef.current;

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    if (import.meta.env.DEV) {
      adminDebugLog('ops-dashboard:delta', { since, sort, filter: filter || '(all new)' });
    }

    try {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      const delta = await fetchOperationsDashboardDelta(
        token,
        {
          since,
          sort,
          filter: filter || undefined,
        },
        { signal: controller.signal }
      );

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      setPayload((prev) => {
        if (!prev) return prev;
        const merged = mergeOperationsDashboardDelta(prev, delta);
        const nextPayload: DashboardPayload = {
          ...prev,
          ...merged,
          ...(delta.changed && delta.schedule
            ? { schedule: delta.schedule as DashboardPayload['schedule'] }
            : {}),
          ...(delta.changed && delta.boatStatus
            ? { boatStatus: delta.boatStatus as DashboardPayload['boatStatus'] }
            : {}),
          ...(delta.changed && delta.alerts
            ? { alerts: delta.alerts as DashboardPayload['alerts'] }
            : {}),
          ...(delta.changed && delta.today ? { today: delta.today } : {}),
        };

        if (delta.changed) {
          const prevKnown = knownNewBookingIdsRef.current;
          const incomingNew = (delta.newBookings || prev.newBookings || []).map((b) => b.id);
          const fresh = incomingNew.filter((id) => !prevKnown.has(id));
          if (fresh.length > 0) {
            setLiveNotice(
              fresh.length === 1 ? '1 new booking arrived' : `${fresh.length} new bookings arrived`
            );
          }
          knownNewBookingIdsRef.current = new Set(incomingNew);
        }

        const signature = dashboardPayloadSignature(nextPayload);
        if (signature === payloadSignatureRef.current) {
          return prev;
        }
        payloadSignatureRef.current = signature;
        return normalizeDashboardPayload(nextPayload);
      });

      lastPollSinceRef.current = delta.generatedAt;
      setLastFetchedAt(Date.now());
      if (delta.changed) {
        setAppliedSort(normalizeOpsSortFromApi(delta.sort));
        setAppliedFilter(normalizeOpsFilterFromApi(delta.filter));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (generation !== fetchGenerationRef.current) {
        return;
      }
      if (import.meta.env.DEV) {
        adminDebugLog('ops-dashboard:delta-failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [getAdminToken, isAdmin, loadDashboard]);

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
      void pollDashboardDelta().finally(() => {
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
  }, [authLoading, isAdmin, pollDashboardDelta]);

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

  const todayTrips = useMemo(() => (payload?.todayTrips ?? []) as OpsBooking[], [payload?.todayTrips]);
  const actionRequired = (payload?.actionRequired || []) as ActionItem[];

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
        (t) => !t.waiver_done || !t.insurance_done || !t.license_done
      ).length,
    [todayTrips]
  );

  const todaySectionProps = {
    todayTrips,
    actionRequired,
    nextTrip,
    paperworkMissing,
  };

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

        <AdminOpsActionCenter counts={dashboardCounts} />

        <AdminOpsNewBookingsSection
          groups={activeNewBookingGroups}
          newBookingsCount={payload.newBookings?.length ?? 0}
          opsSort={opsSort}
          onSortChange={setOpsSort}
          opsFilter={opsFilter}
          onFilterChange={setOpsFilter}
          queryMatchesApplied={queryMatchesApplied}
          bookingsRefreshing={bookingsRefreshing}
          bookingsError={bookingsError}
          onRetry={() => void loadDashboard({ background: hasPayloadRef.current })}
          onMarkAllReviewed={() => void handleMarkAllReviewed()}
          onMarkReviewed={(id) => void handleMarkReviewed(id)}
        />

        <AdminOpsConflictsSection conflicts={payload.conflicts ?? []} />

        <AdminOpsUpcomingSection upcoming={payload.upcoming} />

        {/* ——— Compact mobile command dashboard ——— */}
        <section className="space-y-5">
          <AdminOpsTodaySummary {...todaySectionProps} />

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

        <AdminOpsTodayMobileDetail todayTrips={todayTrips} actionRequired={actionRequired} />

        {/* ——— Full ops detail (desktop) ——— */}
        <div className="hidden space-y-6 lg:block">
          <AdminOpsTodayDesktopPanel todayTrips={todayTrips} actionRequired={actionRequired} />
          <AdminOpsScheduleSection boats={(payload.schedule?.boats ?? []) as DashboardPayload['schedule']['boats']} />
          <AdminOpsFleetRevenueSection
            boatStatus={(payload.boatStatus ?? []) as DashboardPayload['boatStatus']}
            revenue={payload.revenue}
          />
          <AdminOpsInsightsSection
            sourceRows={sourceRows}
            weather={weather}
            alerts={payload.alerts ?? []}
          />
          <AdminOpsRecentActivitySection events={payload.recentActivity ?? []} />
        </div>
      </div>
    </AdminShell>
  );
}
