import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, CloudSun, DollarSign, ShipWheel, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import { env } from '../config/env.js';
import { adminCharterCapacityLines } from '../lib/charterCapacity';
import { fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

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

type DashboardPayload = {
  todayTrips: OpsBooking[];
  actionRequired: ActionItem[];
  schedule: { boats: BoatStatus[]; bookings: OpsBooking[] };
  boatStatus: BoatStatus[];
  revenue: { today: RevenueSummary; week: RevenueSummary; month: RevenueSummary };
  bookingSources: Record<string, number>;
  recentActivity: Activity[];
  weather?: Record<string, any>;
  alerts: ActionItem[];
};

const money = (value: number | string | null | undefined) => `$${Number(value || 0).toFixed(2)}`;

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

  const getAdminToken = useCallback(async () => {
    const { data } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return data.session?.access_token || null;
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      const data = await fetchJsonWithTimeout<DashboardPayload>(
        'Operations dashboard',
        `${env.apiUrl}/api/admin/operations-dashboard`,
        { headers: { Authorization: `Bearer ${token}` } },
        20000
      );
      setPayload(data);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load operations dashboard.');
    } finally {
      setLoading(false);
    }
  }, [getAdminToken, isAdmin]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadDashboard();
  }, [authLoading, isAdmin, loadDashboard]);

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
    return <FullPageLoader message="Loading operations dashboard…" />;
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

  return (
    <AdminShell
      title="Operations Dashboard"
      subtitle="Today's trips, paperwork, boats, revenue, and alerts"
      actions={
        <button
          type="button"
          onClick={() => void loadDashboard()}
          disabled={loading}
          className="min-h-11 rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      <div className="space-y-6">
        {notice ? <div className="rounded-lg bg-red-100 px-4 py-3 font-semibold text-red-800">{notice}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            ['New Staff Booking', '/admin/staff-booking'],
            ['Calendar', '/admin/calendar'],
            ['Outbox', '/admin/outbox'],
            ['Disputes', '/admin/disputes'],
            ['Shop Orders', '/admin/shop-orders'],
            ["Today's Trips", '#today-trips'],
            ['Customers', '/admin/bookings'],
            ['Blocked Dates', '/admin/calendar'],
          ].map(([label, href]) => (
            <a key={label} href={href} className="rounded-2xl bg-white p-4 text-center font-black text-slate-900 shadow hover:bg-amber-50">
              {label}
            </a>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
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
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize">{trip.payment_status.replace(/_/g, ' ')}</span>
                        {statusPill(trip.waiver_done, 'Waiver')}
                        {statusPill(trip.insurance_done, 'Insurance')}
                        {statusPill(trip.license_done, 'License')}
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
        </section>

        <section className="rounded-2xl bg-white p-5 shadow">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-cyan-700" />
            <h2 className="text-2xl font-black">Today&apos;s Schedule</h2>
          </div>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[760px] space-y-3">
              {(payload?.schedule.boats || []).map((boat) => (
                <div key={boat.id} className="grid grid-cols-[160px_1fr] items-stretch gap-3">
                  <div className="rounded-lg bg-slate-100 p-3 font-black">{boat.name}</div>
                  <div className="flex min-h-[56px] gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                    {boat.bookings.length === 0 ? (
                      <span className="self-center text-sm text-slate-500">Open all day</span>
                    ) : (
                      boat.bookings.map((booking) => (
                        <Link key={booking.id} to={`/admin/bookings/${booking.id}`} className="min-w-[180px] rounded-lg bg-blue-100 px-3 py-2 text-sm font-bold text-blue-950">
                          {timeLabel(booking.start_time, booking.end_time)}<br />{booking.customer_name}
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
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
            {payload ? revenueCard('Today', payload.revenue.today) : null}
            {payload ? revenueCard('This Week', payload.revenue.week) : null}
            {payload ? revenueCard('This Month', payload.revenue.month) : null}
          </div>
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
              <div><span className="font-bold">Conditions:</span> {weather.status || weather.shortForecast || weather.error || 'Unavailable'}</div>
              <div><span className="font-bold">Wind:</span> {weather.windSpeed != null ? `${Math.round(Number(weather.windSpeed))} mph ${weather.windDirection || ''}` : 'Unavailable'}</div>
              <div><span className="font-bold">Temperature:</span> {weather.airTempF != null ? `${Math.round(Number(weather.airTempF))}°F` : 'Unavailable'}</div>
              <div><span className="font-bold">Wave Height:</span> {weather.waveHeightFt != null ? `${Number(weather.waveHeightFt).toFixed(1)} ft` : 'Unavailable'}</div>
              <div><span className="font-bold">Rain Chance:</span> {weather.forecastPeriods?.[0]?.shortForecast || weather.shortForecast || 'Unavailable'}</div>
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
                <div className="font-bold">{event.event_type.replace(/_/g, ' ')}</div>
                <div className="text-sm text-slate-600">{event.message || 'Booking activity'}</div>
                <div className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
