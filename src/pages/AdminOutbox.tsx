import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import AdminActions from '../components/admin/AdminActions';
import StatusBadge from '../components/admin/StatusBadge';
import { humanizeLabel, shortId } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';
import { fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

type OutboxRow = {
  id: string;
  booking_id: string | null;
  customer_message_id?: string | null;
  customer_name: string;
  customer_email: string | null;
  channel: 'email' | 'sms';
  message_type: string;
  recipient: string;
  subject: string | null;
  body?: string | null;
  status: string;
  provider?: string | null;
  sent_by: string | null;
  sent_at: string | null;
  created_at: string;
  error_message: string | null;
  reviewed_at: string | null;
};

const emptyFilters = {
  from: '',
  to: '',
  channel: '',
  status: '',
  messageType: '',
  search: '',
  recipient: '',
  bookingId: '',
};

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (['sent', 'delivered', 'opened', 'clicked'].includes(s)) return 'bg-green-100 text-green-800';
  if (s === 'failed') return 'bg-red-100 text-red-800';
  if (['queued', 'pending'].includes(s)) return 'bg-amber-100 text-amber-900';
  return 'bg-slate-100 text-slate-700';
}

function label(value: string | null | undefined) {
  return String(value || '-').replace(/_/g, ' ');
}

function dateTime(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '-';
}

export default function AdminOutbox() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [items, setItems] = useState<OutboxRow[]>([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [selected, setSelected] = useState<OutboxRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const getAdminToken = useCallback(async () => {
    const { data } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return data.session?.access_token || null;
  }, []);

  const apiRequest = useCallback(
    async <T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> => {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      return fetchJsonWithTimeout<T>(
        'Admin outbox',
        `${env.apiUrl}${path}`,
        {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init.headers || {}),
          },
        },
        20000
      );
    },
    [getAdminToken]
  );

  const loadOutbox = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value.trim()) params.set(key, value.trim());
      });
      const payload = (await apiRequest(`/api/admin/outbox?${params.toString()}`)) as {
        items?: OutboxRow[];
      };
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load outbox.' });
    } finally {
      setHasLoaded(true);
      setLoading(false);
    }
  }, [apiRequest, filters, isAdmin]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadOutbox();
  }, [authLoading, isAdmin, loadOutbox]);

  const messageTypes = useMemo(
    () => Array.from(new Set(items.map((row) => row.message_type).filter(Boolean))).sort(),
    [items]
  );

  const viewMessage = async (id: string) => {
    setBusyId(id);
    try {
      const payload = await apiRequest<{ item?: OutboxRow }>(`/api/admin/outbox/${id}`);
      setSelected(payload.item || null);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load message.' });
    } finally {
      setBusyId(null);
    }
  };

  const resendMessage = async (row: OutboxRow) => {
    if (!window.confirm(`Send this message again to ${row.recipient}?`)) return;
    setBusyId(row.id);
    try {
      await apiRequest(`/api/admin/outbox/${row.id}/resend`, { method: 'POST', body: '{}' });
      setNotice({ variant: 'success', text: 'Message resent and logged as a new outbox row.' });
      await loadOutbox();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not resend message.' });
    } finally {
      setBusyId(null);
    }
  };

  const markReviewed = async (row: OutboxRow) => {
    setBusyId(row.id);
    try {
      await apiRequest(`/api/admin/outbox/${row.id}/reviewed`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewed: true }),
      });
      setNotice({ variant: 'success', text: 'Message marked reviewed.' });
      await loadOutbox();
      if (selected?.id === row.id) setSelected((prev) => (prev ? { ...prev, reviewed_at: new Date().toISOString() } : prev));
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not mark reviewed.' });
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }
  if (loading && !hasLoaded) return <FullPageLoader message="Loading communications outbox…" />;

  return (
    <AdminShell
      title="Communications Outbox"
      subtitle="Booking emails, SMS, and contact inbox replies logged from admin"
      actions={
        <button
          type="button"
          onClick={() => void loadOutbox()}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-600 px-4 py-3 text-sm font-bold text-white"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Refresh
        </button>
      }
    >
        {notice ? (
          <div className={`mb-5 rounded-xl px-4 py-3 font-semibold ${notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {notice.text}
          </div>
        ) : null}

        <section className="rounded-2xl bg-white p-5 shadow">
          <h2 className="text-xl font-black">Filters</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="rounded-lg border px-3 py-3" />
            <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="rounded-lg border px-3 py-3" />
            <select value={filters.channel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))} className="rounded-lg border px-3 py-3">
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="rounded-lg border px-3 py-3">
              <option value="">All statuses</option>
              {['queued', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'skipped', 'pending'].map((status) => <option key={status} value={status}>{label(status)}</option>)}
            </select>
            <select value={filters.messageType} onChange={(e) => setFilters((f) => ({ ...f, messageType: e.target.value }))} className="rounded-lg border px-3 py-3">
              <option value="">All message types</option>
              {messageTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}
            </select>
            <input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Customer search" className="rounded-lg border px-3 py-3" />
            <input value={filters.recipient} onChange={(e) => setFilters((f) => ({ ...f, recipient: e.target.value }))} placeholder="Recipient search" className="rounded-lg border px-3 py-3" />
            <input value={filters.bookingId} onChange={(e) => setFilters((f) => ({ ...f, bookingId: e.target.value }))} placeholder="Booking ID" className="rounded-lg border px-3 py-3" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void loadOutbox()} className="rounded-xl bg-slate-900 px-5 py-3 font-black text-white">Apply Filters</button>
            <button type="button" onClick={() => setFilters(emptyFilters)} className="rounded-xl border px-5 py-3 font-black">Clear</button>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow">
          <div className="border-b px-5 py-4">
            <h2 className="flex items-center gap-2 text-xl font-black"><Mail className="h-5 w-5 text-amber-600" />Outbox</h2>
            <p className="text-sm text-slate-500">{items.length} message{items.length === 1 ? '' : 's'} shown</p>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-slate-500">No communications found.</p>
          ) : (
            <AdminResponsiveList
              desktop={
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                      <tr>
                        {['Date/Time', 'Customer', 'Booking', 'Channel', 'Message Type', 'Recipient', 'Subject', 'Status', 'Sent By', 'Actions'].map((h) => (
                          <th key={h} className="px-4 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((row) => (
                        <tr key={row.id} className={row.reviewed_at ? 'bg-white' : 'bg-amber-50/40'}>
                          <td className="whitespace-nowrap px-4 py-4 font-semibold">{dateTime(row.sent_at || row.created_at)}</td>
                          <td className="px-4 py-4">{row.customer_name}<div className="break-all text-xs text-slate-500">{row.customer_email}</div></td>
                          <td className="px-4 py-4">
                            {row.booking_id ? (
                              <Link to={`/admin/bookings/${row.booking_id}`} className="font-bold text-amber-700 underline">Open Booking</Link>
                            ) : row.customer_message_id ? (
                              <Link to="/admin/messages" className="font-bold text-amber-700 underline">Contact Inbox</Link>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="px-4 py-4 uppercase">{row.channel}</td>
                          <td className="px-4 py-4 capitalize">{label(row.message_type)}</td>
                          <td className="max-w-[220px] break-all px-4 py-4">{row.recipient}</td>
                          <td className="max-w-[260px] px-4 py-4">{row.subject || '-'}</td>
                          <td className="px-4 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(row.status)}`}>{label(row.status)}</span></td>
                          <td className="max-w-[160px] break-all px-4 py-4 text-xs text-slate-600" title={row.sent_by || undefined}>
                            {row.sent_by && row.sent_by.includes('@') ? row.sent_by : shortId(row.sent_by || 'system/admin', 12)}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-col gap-2">
                              <button type="button" onClick={() => void viewMessage(row.id)} disabled={busyId === row.id} className="min-h-11 rounded-lg border px-3 py-2 font-bold hover:bg-slate-50">View Message</button>
                              <button type="button" onClick={() => void resendMessage(row)} disabled={busyId === row.id} className="min-h-11 rounded-lg bg-green-700 px-3 py-2 font-bold text-white disabled:opacity-50">Resend</button>
                              {!row.reviewed_at ? <button type="button" onClick={() => void markReviewed(row)} disabled={busyId === row.id} className="min-h-11 rounded-lg bg-amber-600 px-3 py-2 font-bold text-white disabled:opacity-50">Mark Reviewed</button> : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              mobile={
                <div className="space-y-3 p-3">
                  {items.map((row) => (
                    <MobileAdminCard
                      key={row.id}
                      className={row.reviewed_at ? undefined : 'bg-amber-50/50'}
                      title={row.customer_name || 'Customer'}
                      subtitle={dateTime(row.sent_at || row.created_at)}
                      badge={
                        <StatusBadge tone={row.status === 'failed' ? 'danger' : row.status === 'sent' || row.status === 'delivered' ? 'success' : 'warning'}>
                          {humanizeLabel(row.status)}
                        </StatusBadge>
                      }
                      fields={[
                        { label: 'Type', value: humanizeLabel(row.message_type) },
                        { label: 'Channel', value: String(row.channel || '').toUpperCase() },
                        { label: 'To', value: row.recipient },
                        { label: 'Subject', value: row.subject || '—', hideIfEmpty: true },
                        {
                          label: 'Booking',
                          value: row.booking_id ? (
                            <Link to={`/admin/bookings/${row.booking_id}`} className="font-bold text-amber-700 underline">
                              Open ({shortId(row.booking_id)})
                            </Link>
                          ) : row.customer_message_id ? (
                            <Link to="/admin/bookings#contact-inbox" className="font-bold text-amber-700 underline">
                              Contact Inbox
                            </Link>
                          ) : (
                            '—'
                          ),
                        },
                      ]}
                      actions={
                        <AdminActions>
                          <button type="button" onClick={() => void viewMessage(row.id)} disabled={busyId === row.id} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-50 disabled:opacity-50">
                            View Message
                          </button>
                          <button type="button" onClick={() => void resendMessage(row)} disabled={busyId === row.id} className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                            Resend
                          </button>
                          {!row.reviewed_at ? (
                            <button type="button" onClick={() => void markReviewed(row)} disabled={busyId === row.id} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">
                              Mark Reviewed
                            </button>
                          ) : null}
                        </AdminActions>
                      }
                    />
                  ))}
                </div>
              }
            />
          )}
        </section>

      {selected ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Message Details</h2>
                <p className="text-sm text-slate-500">{label(selected.message_type)}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg bg-slate-100 px-5 py-3 font-black">Close</button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">From</div><div className="mt-1">Launch Zone Charters</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">To</div><div className="mt-1 break-all">{selected.recipient}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Subject</div><div className="mt-1">{selected.subject || '-'}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Status</div><div className="mt-1 capitalize">{label(selected.status)}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Channel</div><div className="mt-1 uppercase">{selected.channel}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Sent At</div><div className="mt-1">{dateTime(selected.sent_at || selected.created_at)}</div></div>
            </div>
            {selected.error_message ? <div className="mt-4 rounded-xl bg-red-100 p-4 font-semibold text-red-800">{selected.error_message}</div> : null}
            <div className="mt-4 rounded-xl border p-4">
              <div className="text-xs font-black uppercase text-slate-500">Body</div>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-4 text-sm">{selected.body || '-'}</pre>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => setSelected(null)} className="rounded-xl border px-5 py-4 text-lg font-black">Close</button>
              <button type="button" onClick={() => void resendMessage(selected)} disabled={busyId === selected.id} className="rounded-xl bg-green-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50">Resend</button>
              {selected.booking_id ? (
                <Link to={`/admin/bookings/${selected.booking_id}`} className="rounded-xl bg-amber-600 px-5 py-4 text-center text-lg font-black text-white">Open Booking</Link>
              ) : (
                <Link to="/admin/bookings#contact-inbox" className="rounded-xl bg-amber-600 px-5 py-4 text-center text-lg font-black text-white">Contact Inbox</Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
