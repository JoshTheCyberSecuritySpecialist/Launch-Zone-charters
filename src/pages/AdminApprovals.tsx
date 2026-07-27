import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import AdminActions from '../components/admin/AdminActions';
import AdminSignatureVerification from '../components/admin/AdminSignatureVerification';
import StatusBadge from '../components/admin/StatusBadge';
import { humanizeLabel, shortId } from '../components/admin/adminDisplay';
import { withTimeout, describeError } from '../lib/adminDiagnostics';
import { logSupabaseError } from '../lib/supabaseErrors';
import { env } from '../config/env.js';

type PendingBooking = {
  id: string;
  status: string;
  start_time: string;
  booking_source: string | null;
  guest_count: number | null;
  customers?: { full_name?: string | null; email?: string | null } | null;
  boats?: { name?: string | null } | null;
};

type PendingPreTrip = {
  id: string;
  admin_status: string;
  created_at: string;
  customer_name?: string | null;
  email?: string | null;
  matched_booking_id?: string | null;
  waiver_signed?: boolean;
  waiver_signature?: string | null;
  waiver_signed_at?: string | null;
};

type GrouponRequestRow = {
  id: string;
  status: string;
  startTime: string;
  guestCount: number | null;
  createdAt: string;
  customerName: string;
  email: string | null;
  boatName: string | null;
  voucherMasked: string | null;
};

export default function AdminApprovals() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<PendingBooking[]>([]);
  const [grouponRequests, setGrouponRequests] = useState<GrouponRequestRow[]>([]);
  const [grouponFilter, setGrouponFilter] = useState('pending_review');
  const [preTrips, setPreTrips] = useState<PendingPreTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = (await withTimeout('Admin session', supabase.auth.getSession(), 12000)).data.session
        ?.access_token;
      const grouponPromise =
        env.apiUrlConfigured && env.apiUrl && token
          ? fetch(`${env.apiUrl}/api/admin/groupon-requests?filter=${encodeURIComponent(grouponFilter)}`, {
              headers: { Authorization: `Bearer ${token}` },
            }).then(async (res) => {
              const payload = (await res.json().catch(() => ({}))) as { requests?: GrouponRequestRow[] };
              return res.ok ? payload.requests || [] : [];
            })
          : Promise.resolve([] as GrouponRequestRow[]);

      const [bookingRes, preTripRes, grouponRows] = await withTimeout(
        'Admin approvals queues',
        Promise.all([
          supabase
            .from('bookings')
            .select('id, status, start_time, booking_source, guest_count, customers(full_name, email), boats(name)')
            .in('status', ['pending', 'pending_verification'])
            .order('start_time', { ascending: true })
            .limit(50),
          supabase
            .from('pre_trip_submissions')
            .select(
              'id, admin_status, created_at, customer_name, email, matched_booking_id, waiver_signed, waiver_signature, waiver_signed_at'
            )
            .eq('admin_status', 'pending')
            .order('created_at', { ascending: false })
            .limit(50),
          grouponPromise,
        ]),
        15000
      );

      logSupabaseError('AdminApprovals.bookings', bookingRes.error);
      logSupabaseError('AdminApprovals.preTrip', preTripRes.error);

      if (bookingRes.error || preTripRes.error) {
        setError(
          bookingRes.error?.message ||
            preTripRes.error?.message ||
            'Could not load approval queues.'
        );
      }

      setBookings((bookingRes.data as PendingBooking[]) || []);
      setGrouponRequests(grouponRows || []);
      setPreTrips((preTripRes.data as PendingPreTrip[]) || []);
    } catch (err) {
      setError(describeError(err, 'Could not load approval queues.'));
      setBookings([]);
      setGrouponRequests([]);
      setPreTrips([]);
    } finally {
      setLoading(false);
    }
  }, [grouponFilter]);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  if (authLoading) {
    return <FullPageLoader message="Checking admin access…" />;
  }

  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }

  return (
    <AdminShell
      title="Pending Approvals"
      subtitle="Items waiting for review — open a record to act."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/bookings"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800"
          >
            Back to Hub
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      }
    >
      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-slate-900">Recent Groupon requests</h2>
            <p className="text-sm text-slate-600">Newest Groupon booking requests awaiting review.</p>
          </div>
          <select
            value={grouponFilter}
            onChange={(e) => setGrouponFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            <option value="pending_review">Pending review</option>
            <option value="new_today">New today</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
        {loading && grouponRequests.length === 0 ? (
          <p className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-6 text-fuchsia-900">Loading…</p>
        ) : grouponRequests.length === 0 ? (
          <p className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-6 text-fuchsia-900">
            No Groupon requests in this filter.
          </p>
        ) : (
          <div className="space-y-3">
            {grouponRequests.map((row) => (
              <MobileAdminCard
                key={row.id}
                title={`NEW GROUPON REQUEST — ${row.customerName}`}
                subtitle={row.email || undefined}
                badge={<StatusBadge tone="warning">{humanizeLabel(row.status)}</StatusBadge>}
                fields={[
                  {
                    label: 'Requested trip',
                    value: new Date(row.startTime).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  },
                  { label: 'Guests', value: String(row.guestCount || '—') },
                  {
                    label: 'Submitted',
                    value: new Date(row.createdAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  },
                  { label: 'Voucher', value: row.voucherMasked || '—' },
                  { label: 'Boat', value: row.boatName || 'Unassigned' },
                ]}
                actions={
                  <AdminActions>
                    <Link
                      to={`/admin/bookings/${row.id}`}
                      className="rounded-lg bg-fuchsia-700 px-3 py-2 text-center text-sm font-semibold text-white"
                    >
                      Review request
                    </Link>
                  </AdminActions>
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-slate-900">Bookings</h2>
            <p className="text-sm text-slate-600">Pending or pending verification.</p>
          </div>
          <Link to="/admin/bookings/list" className="text-sm font-bold text-amber-800 underline">
            Open full bookings list
          </Link>
        </div>
        {loading && bookings.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">Loading…</p>
        ) : bookings.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
            No bookings need approval right now.
          </p>
        ) : (
          <div className="space-y-3">
            {bookings.map((row) => (
              <MobileAdminCard
                key={row.id}
                title={
                  row.booking_source === 'groupon'
                    ? `New Groupon request — ${row.customers?.full_name || 'Customer'}`
                    : row.customers?.full_name || 'Customer'
                }
                subtitle={row.customers?.email || undefined}
                badge={
                  <div className="flex flex-wrap gap-2">
                    {row.booking_source === 'groupon' ? (
                      <StatusBadge tone="warning">Groupon</StatusBadge>
                    ) : null}
                    <StatusBadge tone="warning">{humanizeLabel(row.status)}</StatusBadge>
                  </div>
                }
                fields={[
                  {
                    label: 'Trip',
                    value: new Date(row.start_time).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  },
                  { label: 'Guests', value: String(row.guest_count || '—') },
                  { label: 'Boat', value: row.boats?.name || '—' },
                  { label: 'Ref', value: shortId(row.id, 10) },
                ]}
                actions={
                  <AdminActions>
                    <Link
                      to={`/admin/bookings/${row.id}`}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-center text-sm font-semibold text-white"
                    >
                      Review request
                    </Link>
                  </AdminActions>
                }
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-slate-900">Pre-Trip Submissions</h2>
            <p className="text-sm text-slate-600">Waiting to be matched or approved.</p>
          </div>
          <Link to="/admin/pre-trip" className="text-sm font-bold text-amber-800 underline">
            Open pre-trip queue
          </Link>
        </div>
        {loading && preTrips.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">Loading…</p>
        ) : preTrips.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
            No pending pre-trip submissions.
          </p>
        ) : (
          <div className="space-y-3">
            {preTrips.map((row) => (
              <MobileAdminCard
                key={row.id}
                title={row.customer_name || 'Customer'}
                subtitle={row.email || undefined}
                badge={<StatusBadge tone="warning">{humanizeLabel(row.admin_status)}</StatusBadge>}
                fields={[
                  {
                    label: 'Submitted',
                    value: new Date(row.created_at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  },
                  {
                    label: 'Waiver',
                    value: row.waiver_signed ? (
                      <AdminSignatureVerification
                        variant="compact"
                        mode="pre_trip"
                        data={{
                          waiver_signed: row.waiver_signed,
                          waiver_signature: row.waiver_signature,
                          waiver_signed_at: row.waiver_signed_at,
                          created_at: row.created_at,
                        }}
                      />
                    ) : (
                      'Not signed'
                    ),
                  },
                  {
                    label: 'Matched booking',
                    value: row.matched_booking_id ? shortId(row.matched_booking_id, 10) : 'Not matched',
                  },
                ]}
                actions={
                  <AdminActions>
                    <Link
                      to={`/admin/pre-trip/${row.id}`}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-center text-sm font-semibold text-white"
                    >
                      Review submission
                    </Link>
                  </AdminActions>
                }
              />
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
