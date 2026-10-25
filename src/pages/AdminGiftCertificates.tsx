import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Gift, RefreshCw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import AdminId from '../components/admin/AdminId';
import { humanizeLabel } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';

type GiftStatus = 'all' | 'active' | 'redeemed' | 'cancelled' | 'refunded';

type GiftCertificateRow = {
  id: string;
  giftCode: string;
  status: string;
  packageId: string | null;
  packageName: string | null;
  guestCount: number;
  recipientName: string | null;
  recipientEmail: string | null;
  fromName: string | null;
  giftMessage: string | null;
  purchaserName: string | null;
  purchaserEmail: string | null;
  purchaserPhone: string | null;
  seasonYear: number | null;
  validFrom: string | null;
  validUntil: string | null;
  amountPaidCents: number;
  originalValueCents: number;
  ticketIndex: number;
  recipientMode: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  redeemedBookingId: string | null;
  redeemedAt: string | null;
  confirmationEmailSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type GiftSettings = {
  giftSalesEnabled: boolean;
  giftSalesEnv: string;
  seasons: { year: number; bookingStart: string; bookingEnd: string; salesOpen: boolean }[];
  note?: string;
};

const STATUS_FILTERS: { value: GiftStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'redeemed', label: 'Redeemed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refunded', label: 'Refunded' },
];

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s === 'active') return 'bg-emerald-100 text-emerald-800';
  if (s === 'redeemed') return 'bg-sky-100 text-sky-800';
  if (s === 'refunded' || s === 'cancelled') return 'bg-red-100 text-red-800';
  return 'bg-slate-100 text-slate-700';
}

function formatMoneyCents(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    (Number(cents) || 0) / 100
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—';
}

function DetailPanel({ row }: { row: GiftCertificateRow }) {
  return (
    <div className="grid gap-4 border-t border-slate-100 bg-slate-50/80 px-4 py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">People</p>
        <dl className="mt-2 space-y-1 text-slate-700">
          <div>
            <dt className="inline font-medium">Purchaser: </dt>
            <dd className="inline">
              {row.purchaserName || '—'} {row.purchaserEmail ? `(${row.purchaserEmail})` : ''}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Phone: </dt>
            <dd className="inline">{row.purchaserPhone || '—'}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Recipient: </dt>
            <dd className="inline">
              {row.recipientName || '—'}
              {row.recipientEmail ? ` (${row.recipientEmail})` : ''}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">From: </dt>
            <dd className="inline">{row.fromName || '—'}</dd>
          </div>
          {row.giftMessage ? (
            <div>
              <dt className="inline font-medium">Message: </dt>
              <dd className="inline">{row.giftMessage}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket</p>
        <dl className="mt-2 space-y-1 text-slate-700">
          <div>
            <dt className="inline font-medium">Package: </dt>
            <dd className="inline">{row.packageName || row.packageId || '—'}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Guests: </dt>
            <dd className="inline">{row.guestCount}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Paid: </dt>
            <dd className="inline">{formatMoneyCents(row.amountPaidCents)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Season: </dt>
            <dd className="inline">
              {row.seasonYear || '—'} ({row.validFrom || '?'} – {row.validUntil || '?'})
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Redeem page: </dt>
            <dd className="inline">
              <Link
                to={`/redeem/${encodeURIComponent(row.giftCode)}`}
                className="font-semibold text-sky-800 underline"
                target="_blank"
                rel="noreferrer"
              >
                /redeem/{row.giftCode}
              </Link>
            </dd>
          </div>
        </dl>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stripe / redemption</p>
        <dl className="mt-2 space-y-1 text-slate-700">
          <div>
            <dt className="inline font-medium">Checkout: </dt>
            <dd className="inline">
              <AdminId value={row.stripeCheckoutSessionId} len={14} empty="—" />
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Payment intent: </dt>
            <dd className="inline">
              <AdminId value={row.stripePaymentIntentId} len={14} empty="—" />
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Email sent: </dt>
            <dd className="inline">{formatDate(row.confirmationEmailSentAt)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Redeemed: </dt>
            <dd className="inline">{formatDate(row.redeemedAt)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Booking: </dt>
            <dd className="inline">
              {row.redeemedBookingId ? (
                <Link
                  to={`/admin/bookings/${row.redeemedBookingId}`}
                  className="font-semibold text-sky-800 underline"
                >
                  Open booking
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export default function AdminGiftCertificates() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<GiftCertificateRow[]>([]);
  const [settings, setSettings] = useState<GiftSettings | null>(null);
  const [status, setStatus] = useState<GiftStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const getAdminToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, []);

  const apiRequest = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      const res = await fetch(`${env.apiUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Request failed.');
      return payload;
    },
    [getAdminToken]
  );

  const loadRows = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: '100' });
      if (q) params.set('q', q);
      const payload = await apiRequest(`/api/admin/gift-certificates?${params.toString()}`);
      setRows(Array.isArray(payload.certificates) ? payload.certificates : []);
      setTotal(Number(payload.total) || 0);
      if (payload.settings) setSettings(payload.settings as GiftSettings);
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof Error ? err.message : 'Could not load gift certificates.',
      });
    } finally {
      setLoading(false);
    }
  }, [apiRequest, isAdmin, q, status]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!notice || notice.variant !== 'success') return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const updateStatus = async (row: GiftCertificateRow, nextStatus: string) => {
    if (nextStatus === row.status) return;
    setBusyId(row.id);
    try {
      await apiRequest(`/api/admin/gift-certificates/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setNotice({
        variant: 'success',
        text: `${row.giftCode} updated to ${humanizeLabel(nextStatus)}.`,
      });
      await loadRows();
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof Error ? err.message : 'Could not update gift certificate.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const refundViaStripe = async (row: GiftCertificateRow) => {
    if (row.status === 'redeemed' || row.status === 'refunded') return;
    const ok = window.confirm(
      `Refund Stripe payment for ${row.giftCode}? This marks all tickets from the same purchase as refunded (they can no longer be redeemed).`
    );
    if (!ok) return;
    setBusyId(row.id);
    try {
      const out = (await apiRequest(`/api/admin/gift-certificates/${row.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({}),
      })) as { markedUpdated?: number; refundId?: string | null };
      setNotice({
        variant: 'success',
        text: `Refunded ${row.giftCode}${out.markedUpdated ? ` (${out.markedUpdated} ticket(s) updated)` : ''}.`,
      });
      await loadRows();
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof Error ? err.message : 'Could not refund gift certificate.',
      });
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!user || !isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} message="Admin access required." />;
  }

  return (
    <AdminShell
      title="Gift Tickets"
      subtitle="Bioluminescence gift certificates — search, status, redeem links"
    >
      {notice ? (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm font-semibold ${
            notice.variant === 'success' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
          }`}
          role="status"
        >
          {notice.text}
        </div>
      ) : null}

      {settings ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <Gift className="mt-0.5 h-5 w-5 text-cyan-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Gift sales:{' '}
                <span className={settings.giftSalesEnabled ? 'text-emerald-700' : 'text-red-700'}>
                  {settings.giftSalesEnabled ? 'ON' : 'OFF'}
                </span>
                <span className="ml-2 font-normal text-slate-500">
                  (env {settings.giftSalesEnv}
                  {settings.giftSalesEnabled ? '' : '=false'})
                </span>
              </p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {settings.seasons.map((season) => (
                  <li key={season.year}>
                    {season.year}: {season.bookingStart} – {season.bookingEnd}
                    {season.salesOpen ? '' : ' (closed)'}
                  </li>
                ))}
              </ul>
              {settings.note ? <p className="mt-2 text-xs text-slate-500">{settings.note}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          <span className="font-semibold">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as GiftStatus)}
            className="rounded-md border border-slate-300 px-3 py-2"
          >
            {STATUS_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <form
          className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm text-slate-700"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(searchInput.trim());
          }}
        >
          <span className="font-semibold">Search</span>
          <div className="flex gap-2">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Code, email, or name"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Search className="h-4 w-4" aria-hidden />
              Go
            </button>
          </div>
        </form>
        <button
          type="button"
          onClick={() => void loadRows()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      </div>

      <p className="mb-2 text-xs text-slate-500">
        Showing {rows.length}
        {total > rows.length ? ` of ${total}` : ''} ticket{rows.length === 1 ? '' : 's'}
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
        {loading && rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-500">Loading gift tickets…</p>
        ) : null}
        {!loading && rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-500">No gift certificates match this filter.</p>
        ) : null}

        <AdminResponsiveList
          desktop={
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-8 px-2 py-3" aria-label="Expand" />
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Recipient</th>
                    <th className="px-4 py-3">Purchaser</th>
                    <th className="px-4 py-3">Package</th>
                    <th className="px-4 py-3">Paid</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const expanded = expandedId === row.id;
                    const redeemed = row.status === 'redeemed';
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-b border-slate-100 hover:bg-slate-50/80">
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              onClick={() => setExpandedId(expanded ? null : row.id)}
                              className="min-h-11 min-w-11 rounded p-2 text-slate-500 hover:bg-slate-200"
                              aria-expanded={expanded}
                              aria-label={expanded ? 'Collapse details' : 'Expand details'}
                            >
                              {expanded ? (
                                <ChevronDown className="h-4 w-4" aria-hidden />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden />
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                            {row.giftCode}
                          </td>
                          <td className="px-4 py-3">{row.recipientName || '—'}</td>
                          <td className="max-w-[180px] truncate px-4 py-3">
                            {row.purchaserEmail || row.purchaserName || '—'}
                          </td>
                          <td className="px-4 py-3">
                            {row.packageName || row.packageId || '—'}
                            <span className="block text-xs text-slate-500">{row.guestCount} guest(s)</span>
                          </td>
                          <td className="px-4 py-3">{formatMoneyCents(row.amountPaidCents)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                            {formatDate(row.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}
                            >
                              {humanizeLabel(row.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              {redeemed ? (
                                row.redeemedBookingId ? (
                                  <Link
                                    to={`/admin/bookings/${row.redeemedBookingId}`}
                                    className="text-xs font-semibold text-sky-800 underline"
                                  >
                                    Booking
                                  </Link>
                                ) : (
                                  <span className="text-xs text-slate-400">Redeemed</span>
                                )
                              ) : (
                                <>
                                  <select
                                    value={row.status}
                                    disabled={busyId === row.id}
                                    onChange={(e) => void updateStatus(row, e.target.value)}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                                  >
                                    <option value="active">Active</option>
                                    <option value="cancelled">Cancelled</option>
                                    <option value="refunded">Refunded</option>
                                  </select>
                                  {row.status !== 'refunded' ? (
                                    <button
                                      type="button"
                                      disabled={busyId === row.id}
                                      onClick={() => void refundViaStripe(row)}
                                      className="text-left text-xs font-semibold text-red-700 underline disabled:opacity-50"
                                    >
                                      Stripe refund
                                    </button>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr>
                            <td colSpan={9} className="p-0">
                              <DetailPanel row={row} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
          mobile={
            <div className="space-y-3 p-3">
              {rows.map((row) => (
                <MobileAdminCard
                  key={row.id}
                  title={row.giftCode}
                  subtitle={`${row.recipientName || 'Guest'} · ${row.packageName || row.packageId || 'Bio gift'}`}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}
                      >
                        {humanizeLabel(row.status)}
                      </span>
                      {row.redeemedBookingId ? (
                        <Link
                          to={`/admin/bookings/${row.redeemedBookingId}`}
                          className="text-xs font-semibold text-sky-800 underline"
                        >
                          Booking
                        </Link>
                      ) : row.status !== 'redeemed' ? (
                        <>
                          <select
                            value={row.status}
                            disabled={busyId === row.id}
                            onChange={(e) => void updateStatus(row, e.target.value)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs"
                          >
                            <option value="active">Active</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="refunded">Refunded</option>
                          </select>
                          {row.status !== 'refunded' ? (
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void refundViaStripe(row)}
                              className="text-xs font-semibold text-red-700 underline disabled:opacity-50"
                            >
                              Stripe refund
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  }
                >
                  <p className="text-sm text-slate-600">
                    {formatMoneyCents(row.amountPaidCents)} · {formatDate(row.createdAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{row.purchaserEmail || '—'}</p>
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-sky-800 underline"
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  >
                    {expandedId === row.id ? 'Hide details' : 'Show details'}
                  </button>
                  {expandedId === row.id ? <DetailPanel row={row} /> : null}
                </MobileAdminCard>
              ))}
            </div>
          }
        />
      </div>
    </AdminShell>
  );
}
