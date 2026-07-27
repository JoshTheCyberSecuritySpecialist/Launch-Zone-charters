import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Clock3,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Ship,
  Ticket,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import StatusBadge from '../components/admin/StatusBadge';
import { ADMIN_MOBILE_TOAST_CLASS, humanizeLabel } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';
import { fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

type Tab = 'lookup' | 'exceptions' | 'nightly';

type LookupResult = {
  type: 'booking' | 'voucher';
  matchReason: string;
  id?: string;
  customerName?: string;
  email?: string | null;
  phone?: string | null;
  startTime?: string;
  status?: string;
  bookingSource?: string;
  paymentMethod?: string;
  voucherId?: string;
  voucherMasked?: string;
  ownerName?: string | null;
  localStatus?: string;
  bookingId?: string | null;
};

type SupportRecord = {
  booking: {
    id: string;
    customerName: string;
    email: string | null;
    phone: string | null;
    startTime: string;
    endTime: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string;
    bookingSource: string;
    guestCount: number;
    waiverSigned: boolean;
    adminNotes?: string | null;
    balanceDue?: number;
    totalPrice?: number;
  };
  customer: { full_name?: string; email?: string; phone?: string } | null;
  groupon: {
    id: string;
    voucherMasked: string;
    ownerName: string | null;
    localStatus: string;
    sourceStatus: string;
    dealName: string | null;
    optionName: string | null;
    mapping?: { service_label?: string; covered_guest_count?: number } | null;
  } | null;
  capacity: { status?: string; message?: string; totalWeight?: number; passengerCount?: number } | null;
  waiver: { signed: boolean; insuranceStatus?: string; licenseStatus?: string };
  timeline: Array<{ id: string; at: string; kind: string; title: string; message?: string | null }>;
  communications: Array<{ id: string; message_type: string; channel: string; status: string; created_at: string }>;
};

type ExceptionRow = {
  id: string;
  reason: string;
  detail: string;
  voucherId: string;
  voucherMasked: string;
  ownerName: string | null;
  bookingId: string | null;
  dealName: string | null;
  optionName: string | null;
  localStatus: string;
  sourceStatus: string;
};

type NightlyDeparture = {
  id: string;
  departureTime: string;
  customerName: string;
  phone: string | null;
  guestCount: number;
  totalWeight: number | null;
  waiverSigned: boolean;
  emergencyContact: string | null;
  captainName: string;
  boatName: string;
  bookingSource: string;
  paymentMethod: string;
  arrivalStatus: string;
  groupon: { voucherMasked: string; dealName: string | null; optionName: string | null } | null;
};

type AlternativeSlot = {
  startIso: string;
  label: string;
  date: string;
  available: boolean;
  grouponCompatible: boolean;
  capacityNote?: string;
};

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';
const labelClass = 'mb-1 block text-sm font-semibold text-slate-700';
const buttonPrimary =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-base font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60';
const buttonSecondary =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-bold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60';

const COMM_TEMPLATES: Array<[string, string]> = [
  ['weather_delay', 'Weather delay'],
  ['arrival_instructions', 'Arrival instructions'],
  ['passenger_weight_issue', 'Passenger / weight issue'],
  ['separate_trip_explanation', 'Separate trip explanation'],
  ['groupon_support', 'Groupon support'],
  ['missing_waiver', 'Missing waiver'],
  ['booking_confirmation', 'Booking confirmation'],
];

function formatWhen(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleString();
}

function timeOnly(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function AdminSupport() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('lookup');
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [lookupResults, setLookupResults] = useState<LookupResult[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [record, setRecord] = useState<SupportRecord | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativeSlot[]>([]);
  const [actionReason, setActionReason] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [nightlyDate, setNightlyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [departures, setDepartures] = useState<NightlyDeparture[]>([]);

  useEffect(() => {
    if (!notice || notice.variant !== 'success') return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const getAdminToken = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return session?.access_token || null;
  }, []);

  const apiRequest = useCallback(
    async <T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> => {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        throw new Error('API server URL is not configured (set VITE_API_URL).');
      }
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session unavailable.');
      return fetchJsonWithTimeout<T>(
        'Admin Support',
        `${env.apiUrl}${path}`,
        {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
          },
        },
        30000
      );
    },
    [getAdminToken]
  );

  const runLookup = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (lastFour.trim()) params.set('lastFour', lastFour.trim().slice(-4));
      const payload = await apiRequest<{ results: LookupResult[] }>(`/api/admin/support/lookup?${params.toString()}`);
      setLookupResults(payload.results || []);
      setSelectedBookingId(null);
      setRecord(null);
      setAlternatives([]);
      if ((payload.results || []).length === 0) {
        setNotice({ variant: 'error', text: 'No matches found.' });
      }
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Lookup failed.' });
    } finally {
      setBusy(false);
    }
  }, [apiRequest, lastFour, query]);

  const loadRecord = useCallback(
    async (bookingId: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const [recordPayload, altPayload] = await Promise.all([
          apiRequest<SupportRecord>(`/api/admin/support/records/${bookingId}`),
          apiRequest<{ alternatives: AlternativeSlot[] }>(`/api/admin/support/bookings/${bookingId}/alternatives?limit=6`),
        ]);
        setSelectedBookingId(bookingId);
        setRecord(recordPayload);
        setAlternatives(altPayload.alternatives || []);
      } catch (err) {
        setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load support record.' });
      } finally {
        setBusy(false);
      }
    },
    [apiRequest]
  );

  const loadExceptions = useCallback(async () => {
    setBusy(true);
    try {
      const payload = await apiRequest<{ exceptions: ExceptionRow[] }>('/api/admin/support/exceptions?limit=100');
      setExceptions(payload.exceptions || []);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load exceptions.' });
    } finally {
      setBusy(false);
    }
  }, [apiRequest]);

  const loadNightly = useCallback(async () => {
    setBusy(true);
    try {
      const payload = await apiRequest<{ date: string; departures: NightlyDeparture[] }>(
        `/api/admin/support/nightly-ops?date=${encodeURIComponent(nightlyDate)}`
      );
      setDepartures(payload.departures || []);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load nightly operations.' });
    } finally {
      setBusy(false);
    }
  }, [apiRequest, nightlyDate]);

  useEffect(() => {
    if (tab === 'exceptions') void loadExceptions();
    if (tab === 'nightly') void loadNightly();
  }, [tab, loadExceptions, loadNightly]);

  const runBookingAction = async (action: string, requireReason = false) => {
    if (!selectedBookingId || activeAction) return;
    if (requireReason && !actionReason.trim()) {
      setNotice({ variant: 'error', text: 'Enter a reason for this override.' });
      return;
    }
    setActiveAction(action);
    try {
      await apiRequest(`/api/admin/bookings/${selectedBookingId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action, reason: actionReason.trim() || undefined }),
      });
      setNotice({ variant: 'success', text: 'Action completed.' });
      setActionReason('');
      await loadRecord(selectedBookingId);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Action failed.' });
    } finally {
      setActiveAction(null);
    }
  };

  const previewCommunication = async (messageType: string) => {
    if (!selectedBookingId) return;
    try {
      const payload = await apiRequest<{ preview: { subject: string; emailHtml: string; smsBody: string } }>(
        `/api/admin/bookings/${selectedBookingId}/communications/preview`,
        { method: 'POST', body: JSON.stringify({ message_type: messageType }) }
      );
      const proceed = window.confirm(
        `Preview ${humanizeLabel(messageType)}\n\nSubject: ${payload.preview.subject}\n\nSend email now?`
      );
      if (!proceed) return;
      await apiRequest(`/api/admin/bookings/${selectedBookingId}/communications/send`, {
        method: 'POST',
        body: JSON.stringify({ message_type: messageType, channels: ['email'] }),
      });
      setNotice({ variant: 'success', text: 'Communication sent.' });
      await loadRecord(selectedBookingId);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Communication failed.' });
    }
  };

  const releaseVoucher = async (voucherId: string) => {
    const reason = window.prompt('Reason for releasing this Groupon reservation (required):');
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/groupon-vouchers/${voucherId}/release-reservation`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setNotice({ variant: 'success', text: 'Voucher reservation released.' });
      if (tab === 'exceptions') await loadExceptions();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Release failed.' });
    } finally {
      setBusy(false);
    }
  };

  const tabButtons = useMemo(
    () => [
      { id: 'lookup' as Tab, label: 'Lookup' },
      { id: 'exceptions' as Tab, label: 'Groupon Exceptions' },
      { id: 'nightly' as Tab, label: 'Nightly Ops' },
    ],
    []
  );

  if (authLoading) return <FullPageLoader label="Loading admin support…" />;
  if (!user || !isAdmin) return <AdminAccessDenied />;

  return (
    <AdminShell
      title="Customer Support"
      subtitle="Lookup bookings and vouchers, resolve Groupon exceptions, and run nightly operations."
      actions={
        <Link to="/admin/more" className={buttonSecondary}>
          <ArrowLeft className="h-4 w-4" />
          More Tools
        </Link>
      }
    >
      {notice ? (
        <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-semibold ${ADMIN_MOBILE_TOAST_CLASS(notice.variant)}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        {tabButtons.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-xl px-4 py-3 text-sm font-bold ${
              tab === item.id ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'lookup' ? (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Unified lookup</h2>
            <p className="mt-1 text-sm text-slate-600">
              Search by customer name, email, phone, booking ID, voucher last four, or merchant reference.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="md:col-span-2">
                <span className={labelClass}>Search</span>
                <input
                  className={inputClass}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, email, phone, booking ID, merchant ref"
                />
              </label>
              <label>
                <span className={labelClass}>Voucher last 4</span>
                <input
                  className={inputClass}
                  value={lastFour}
                  onChange={(e) => setLastFour(e.target.value.toUpperCase().slice(0, 4))}
                  placeholder="AB12"
                  maxLength={4}
                />
              </label>
            </div>
            <button type="button" onClick={() => void runLookup()} disabled={busy} className={`${buttonPrimary} mt-4`}>
              <Search className="h-4 w-4" />
              {busy ? 'Searching…' : 'Search'}
            </button>
          </div>

          <AdminResponsiveList
            desktop={
              <div className="overflow-hidden rounded-2xl bg-white shadow">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Match</th>
                      <th className="px-4 py-3">Customer / Voucher</th>
                      <th className="px-4 py-3">When</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {lookupResults.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-slate-500">
                          Run a search to see results.
                        </td>
                      </tr>
                    ) : (
                      lookupResults.map((row, idx) => (
                        <tr key={`${row.type}-${row.id || row.voucherId}-${idx}`} className="border-t border-slate-100">
                          <td className="px-4 py-3 capitalize">{humanizeLabel(row.matchReason)}</td>
                          <td className="px-4 py-3">
                            {row.type === 'booking' ? (
                              <div>
                                <div className="font-bold">{row.customerName}</div>
                                <div className="text-slate-600">{row.email || row.phone || '—'}</div>
                              </div>
                            ) : (
                              <div>
                                <div className="font-bold">{row.ownerName || 'Unknown owner'}</div>
                                <div className="text-slate-600">Voucher {row.voucherMasked}</div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">{row.startTime ? formatWhen(row.startTime) : '—'}</td>
                          <td className="px-4 py-3">
                            <StatusBadge>{row.status || row.localStatus || row.type}</StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.type === 'booking' && row.id ? (
                              <button type="button" className={buttonSecondary} onClick={() => void loadRecord(row.id!)}>
                                Open
                              </button>
                            ) : row.voucherId && row.localStatus === 'reserved' ? (
                              <button type="button" className={buttonSecondary} onClick={() => void releaseVoucher(row.voucherId!)}>
                                Release
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            }
            mobile={
              <div className="space-y-3">
                {lookupResults.length === 0 ? (
                  <p className="text-sm text-slate-500">Run a search to see results.</p>
                ) : (
                  lookupResults.map((row, idx) => (
                    <MobileAdminCard
                      key={`${row.type}-${row.id || row.voucherId}-${idx}`}
                      title={row.type === 'booking' ? row.customerName || 'Booking' : row.ownerName || 'Voucher'}
                      subtitle={row.type === 'booking' ? formatWhen(row.startTime || null) : row.voucherMasked}
                      meta={humanizeLabel(row.matchReason)}
                      actions={
                        row.type === 'booking' && row.id ? (
                          <button type="button" className={buttonSecondary} onClick={() => void loadRecord(row.id!)}>
                            Open
                          </button>
                        ) : undefined
                      }
                    />
                  ))
                )}
              </div>
            }
          />

          {record && selectedBookingId ? (
            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-6">
                <div className="rounded-2xl bg-white p-5 shadow">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black">{record.booking.customerName}</h2>
                      <p className="mt-1 text-sm text-slate-600">{formatWhen(record.booking.startTime)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge>{record.booking.status}</StatusBadge>
                      {record.booking.bookingSource === 'groupon' ? <StatusBadge>Groupon</StatusBadge> : null}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4" />{record.booking.phone || '—'}</div>
                    <div className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4" />{record.booking.email || '—'}</div>
                    <div className="flex items-center gap-2 text-sm"><Users className="h-4 w-4" />{record.booking.guestCount} guests</div>
                    <div className="flex items-center gap-2 text-sm"><Ship className="h-4 w-4" />{record.capacity?.message || 'Capacity OK'}</div>
                  </div>
                  {record.groupon ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                      <div className="font-black">Groupon voucher {record.groupon.voucherMasked}</div>
                      <div>{record.groupon.dealName} · {record.groupon.optionName}</div>
                      <div className="mt-1 text-slate-700">
                        {record.groupon.mapping?.service_label} · Local {record.groupon.localStatus} · Source {record.groupon.sourceStatus}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/admin/bookings/${selectedBookingId}`} className={buttonSecondary}>
                      Full booking detail
                    </Link>
                    <Link to={`/admin/bookings/${selectedBookingId}/edit`} className={buttonSecondary}>
                      Reschedule / edit
                    </Link>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 shadow">
                  <h3 className="text-lg font-black">Timeline</h3>
                  <div className="mt-4 space-y-3">
                    {(record.timeline || []).slice(0, 20).map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                        <div className="font-bold capitalize">{humanizeLabel(item.title)}</div>
                        <div className="text-xs text-slate-500">{formatWhen(item.at)} · {item.kind}</div>
                        {item.message ? <div className="mt-1 text-slate-700">{item.message}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl bg-white p-5 shadow">
                  <h3 className="text-lg font-black">Support actions</h3>
                  <label className="mt-3 block">
                    <span className={labelClass}>Override reason (required for no-show / release)</span>
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                    />
                  </label>
                  <div className="mt-3 grid gap-2">
                    <button type="button" disabled={Boolean(activeAction)} className={buttonSecondary} onClick={() => void runBookingAction('mark_arrived')}>
                      Mark arrived
                    </button>
                    <button type="button" disabled={Boolean(activeAction)} className={buttonSecondary} onClick={() => void runBookingAction('no_show', true)}>
                      Mark no-show
                    </button>
                    <button type="button" disabled={Boolean(activeAction)} className={buttonSecondary} onClick={() => void runBookingAction('send_confirmation')}>
                      Resend confirmation
                    </button>
                    {record.groupon?.localStatus === 'reserved' ? (
                      <button
                        type="button"
                        disabled={Boolean(activeAction)}
                        className={buttonSecondary}
                        onClick={() => void runBookingAction('release_groupon_reservation', true)}
                      >
                        Release Groupon reservation
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 shadow">
                  <h3 className="text-lg font-black">Communications</h3>
                  <div className="mt-3 grid gap-2">
                    {COMM_TEMPLATES.map(([type, label]) => (
                      <button key={type} type="button" className={buttonSecondary} onClick={() => void previewCommunication(type)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 shadow">
                  <h3 className="text-lg font-black">Available alternatives</h3>
                  <div className="mt-3 space-y-2">
                    {alternatives.length === 0 ? (
                      <p className="text-sm text-slate-500">No nearby open slots found.</p>
                    ) : (
                      alternatives.map((slot) => (
                        <div key={slot.startIso} className="rounded-xl border border-slate-200 p-3 text-sm">
                          <div className="font-bold">{slot.label}</div>
                          <div className="text-slate-600">{slot.date} · {slot.grouponCompatible ? 'Groupon compatible' : 'Check mapping'}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'exceptions' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Imported Groupon rows that need staff review.</p>
            <button type="button" onClick={() => void loadExceptions()} disabled={busy} className={buttonSecondary}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
          <AdminResponsiveList
            desktop={
              <div className="overflow-hidden rounded-2xl bg-white shadow">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Issue</th>
                      <th className="px-4 py-3">Voucher</th>
                      <th className="px-4 py-3">Deal</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {exceptions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-slate-500">
                          No exceptions in queue.
                        </td>
                      </tr>
                    ) : (
                      exceptions.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-4 py-3">
                            <div className="font-bold capitalize">{humanizeLabel(row.reason)}</div>
                            <div className="text-slate-600">{row.detail}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold">{row.voucherMasked}</div>
                            <div className="text-slate-600">{row.ownerName || '—'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div>{row.dealName}</div>
                            <div className="text-slate-600">{row.optionName}</div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge>{row.localStatus}</StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              {row.bookingId ? (
                                <button type="button" className={buttonSecondary} onClick={() => { setTab('lookup'); void loadRecord(row.bookingId!); }}>
                                  Open booking
                                </button>
                              ) : null}
                              {row.localStatus === 'reserved' ? (
                                <button type="button" className={buttonSecondary} onClick={() => void releaseVoucher(row.voucherId)}>
                                  Release
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            }
            mobile={
              <div className="space-y-3">
                {exceptions.map((row) => (
                  <MobileAdminCard
                    key={row.id}
                    title={row.voucherMasked}
                    subtitle={row.ownerName || 'Unknown'}
                    meta={humanizeLabel(row.reason)}
                    actions={
                      row.bookingId ? (
                        <button type="button" className={buttonSecondary} onClick={() => { setTab('lookup'); void loadRecord(row.bookingId!); }}>
                          Open
                        </button>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            }
          />
        </div>
      ) : null}

      {tab === 'nightly' ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-5 shadow">
            <div className="flex flex-wrap items-end gap-3">
              <label>
                <span className={labelClass}>Date</span>
                <input type="date" className={inputClass} value={nightlyDate} onChange={(e) => setNightlyDate(e.target.value)} />
              </label>
              <button type="button" onClick={() => void loadNightly()} disabled={busy} className={buttonPrimary}>
                <CalendarDays className="h-4 w-4" />
                Load departures
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {departures.length === 0 ? (
              <p className="text-sm text-slate-500">No departures for this date.</p>
            ) : (
              departures.map((trip) => (
                <div key={trip.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-black">{trip.customerName}</div>
                      <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                        <Clock3 className="h-4 w-4" />
                        {timeOnly(trip.departureTime)}
                      </div>
                    </div>
                    <StatusBadge>{trip.arrivalStatus}</StatusBadge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>Guests: {trip.guestCount}{trip.totalWeight != null ? ` · ${trip.totalWeight} lb` : ''}</div>
                    <div>Captain: {trip.captainName}</div>
                    <div>Boat: {trip.boatName}</div>
                    <div>Source: {humanizeLabel(trip.bookingSource)} · {trip.paymentMethod || '—'}</div>
                    <div>Waiver: {trip.waiverSigned ? 'Signed' : 'Missing'}</div>
                    <div>Phone: {trip.phone || '—'}</div>
                  </div>
                  {trip.groupon ? (
                    <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <Ticket className="h-4 w-4" />
                      Groupon {trip.groupon.voucherMasked} · {trip.groupon.optionName}
                    </div>
                  ) : null}
                  {trip.emergencyContact ? (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-900">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {trip.emergencyContact}
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <Link to={`/admin/bookings/${trip.id}`} className={buttonSecondary}>
                      Open booking
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
