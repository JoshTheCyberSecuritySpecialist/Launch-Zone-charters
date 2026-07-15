import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, Copy, Download, FileArchive, FileText, RefreshCw, Scale, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import StatusBadge from '../components/admin/StatusBadge';
import { humanizeLabel, shortId } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';
import { fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

type DisputeRow = {
  id: string;
  stripe_dispute_id: string;
  stripe_charge_id: string | null;
  payment_intent_id: string | null;
  checkout_session_id: string | null;
  booking_id: string | null;
  shop_order_id: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: string;
  outcome: string | null;
  evidence_due_by: string | null;
  created_at: string;
  updated_at: string;
  bookings?: {
    id: string;
    start_time: string;
    customers?: { full_name?: string; email?: string; phone?: string } | null;
  } | null;
};

type DisputeSummary = {
  open: number;
  needsResponse: number;
  won: number;
  lost: number;
  deadlineSoon: number;
};

type DisputeNote = {
  id: string;
  admin_id: string | null;
  note_text: string;
  created_at: string;
};

type DisputeDetail = {
  dispute: DisputeRow;
  notes: DisputeNote[];
  booking: Record<string, unknown> | null;
};

const statusFilters = [
  ['', 'All'],
  ['open', 'Open'],
  ['needs_response', 'Needs Response'],
  ['won', 'Won'],
  ['lost', 'Lost'],
] as const;

function label(value: string | null | undefined) {
  return String(value || '-').replace(/_/g, ' ');
}

function money(amount: number | string | null | undefined, currency = 'usd') {
  const n = Number(amount || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(n);
}

function dateTime(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '-';
}

function deadlineCountdown(dueBy: string | null | undefined) {
  if (!dueBy) return 'No deadline';
  const due = new Date(dueBy).getTime();
  if (!Number.isFinite(due)) return 'No deadline';
  const diffMs = due - Date.now();
  if (diffMs <= 0) return 'Past due';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h left`;
  const minutes = Math.floor(diffMs / (1000 * 60));
  return `${minutes}m left`;
}

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (['won'].includes(s)) return 'bg-green-100 text-green-800';
  if (['lost', 'charge_refunded'].includes(s)) return 'bg-red-100 text-red-800';
  if (['needs_response', 'warning_needs_response'].includes(s)) return 'bg-amber-100 text-amber-900';
  if (['under_review', 'warning_under_review'].includes(s)) return 'bg-blue-100 text-blue-800';
  return 'bg-slate-100 text-slate-700';
}

export default function AdminDisputes() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [items, setItems] = useState<DisputeRow[]>([]);
  const [summary, setSummary] = useState<DisputeSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState<'pdf' | 'zip' | 'stripe' | null>(null);
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
        'Admin disputes',
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

  const loadDisputes = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const [listPayload, summaryPayload] = await Promise.all([
        apiRequest(`/api/admin/disputes?${params.toString()}`),
        apiRequest('/api/admin/disputes/summary'),
      ]);
      setItems(Array.isArray((listPayload as { items?: DisputeRow[] }).items) ? (listPayload as { items: DisputeRow[] }).items : []);
      setSummary(summaryPayload as DisputeSummary);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load disputes.' });
    } finally {
      setHasLoaded(true);
      setLoading(false);
    }
  }, [apiRequest, isAdmin, search, statusFilter]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadDisputes();
  }, [authLoading, isAdmin, loadDisputes]);

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    setBusy(true);
    try {
      const payload = await apiRequest(`/api/admin/disputes/${encodeURIComponent(id)}`);
      setDetail(payload as DisputeDetail);
      setNoteText('');
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load dispute.' });
      setSelectedId(null);
      setDetail(null);
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!selectedId || !noteText.trim()) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/disputes/${encodeURIComponent(selectedId)}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note_text: noteText.trim() }),
      });
      setNotice({ variant: 'success', text: 'Note added.' });
      await loadDetail(selectedId);
      await loadDisputes();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not add note.' });
    } finally {
      setBusy(false);
    }
  };

  const generateEvidence = async () => {
    if (!selectedId) return;
    setEvidenceLoading(true);
    try {
      const payload = await apiRequest<{ summary?: string }>(
        `/api/admin/disputes/${encodeURIComponent(selectedId)}/evidence-summary`
      );
      setEvidenceSummary(typeof payload.summary === 'string' ? payload.summary : '');
      setEvidenceModalOpen(true);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not generate evidence summary.' });
    } finally {
      setEvidenceLoading(false);
    }
  };

  const copyEvidence = async () => {
    if (!evidenceSummary) return;
    try {
      await navigator.clipboard.writeText(evidenceSummary);
      setNotice({ variant: 'success', text: 'Evidence summary copied to clipboard.' });
    } catch {
      setNotice({ variant: 'error', text: 'Could not copy to clipboard.' });
    }
  };

  const downloadExport = async (path: string, filename: string, kind: 'pdf' | 'zip') => {
    if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
    const token = await getAdminToken();
    if (!token) throw new Error('Admin session expired.');
    setExportLoading(kind);
    try {
      const res = await fetch(`${env.apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Download failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ variant: 'success', text: `${kind.toUpperCase()} downloaded.` });
    } finally {
      setExportLoading(null);
    }
  };

  const submitStripeEvidence = async () => {
    if (!selectedId) return;
    if (
      !window.confirm(
        'Submit the generated evidence summary text to Stripe for this dispute? Review the summary first. This updates the dispute in Stripe.'
      )
    ) {
      return;
    }
    setExportLoading('stripe');
    try {
      await apiRequest(`/api/admin/disputes/${encodeURIComponent(selectedId)}/submit-stripe-evidence`, {
        method: 'POST',
        body: '{}',
      });
      setNotice({ variant: 'success', text: 'Evidence submitted to Stripe.' });
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not submit to Stripe.' });
    } finally {
      setExportLoading(null);
    }
  };

  const selectedCustomer = useMemo(() => {
    if (detail?.booking) {
      const customers = detail.booking.customers as { full_name?: string; email?: string; phone?: string } | undefined;
      return customers || null;
    }
    const row = items.find((item) => item.id === selectedId);
    return row?.bookings?.customers || null;
  }, [detail, items, selectedId]);

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }
  if (loading && !hasLoaded) return <FullPageLoader message="Loading Stripe disputes…" />;

  return (
    <AdminShell
      title="Stripe Disputes"
      subtitle="Payment chargebacks linked to bookings"
      actions={
        <button
          type="button"
          onClick={() => void loadDisputes()}
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

        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Open', summary?.open ?? 0, 'text-slate-900'],
            ['Needs Response', summary?.needsResponse ?? 0, 'text-amber-700'],
            ['Deadline < 72h', summary?.deadlineSoon ?? 0, 'text-red-700'],
            ['Won', summary?.won ?? 0, 'text-green-700'],
            ['Lost', summary?.lost ?? 0, 'text-red-700'],
          ].map(([title, count, color]) => (
            <div key={title} className="rounded-2xl bg-white p-4 shadow">
              <div className="text-sm font-bold uppercase tracking-wide text-slate-500">{title}</div>
              <div className={`mt-2 text-3xl font-black ${color}`}>{count}</div>
            </div>
          ))}
        </section>

        <section className="mb-6 rounded-2xl bg-white p-4 shadow">
          <div className="grid gap-3 lg:grid-cols-[180px_1fr_auto]">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 font-semibold"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {statusFilters.map(([value, text]) => (
                <option key={value || 'all'} value={value}>
                  {text}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Search customer, email, phone, booking ID, Stripe IDs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" onClick={() => void loadDisputes()} className="rounded-lg bg-slate-900 px-4 py-2 font-bold text-white">
              Search
            </button>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <section className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-black">Disputes</h2>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-slate-500">No disputes found.</p>
            ) : (
              <AdminResponsiveList
                desktop={
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Customer</th>
                          <th className="px-4 py-3">Trip</th>
                          <th className="px-4 py-3">Amount</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Reason</th>
                          <th className="px-4 py-3">Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((row) => {
                          const customer = row.bookings?.customers;
                          return (
                            <tr
                              key={row.id}
                              className={`cursor-pointer border-t border-slate-100 hover:bg-amber-50 ${selectedId === row.id ? 'bg-amber-50' : ''}`}
                              onClick={() => void loadDetail(row.id)}
                            >
                              <td className="px-4 py-3">
                                <div className="font-bold">{customer?.full_name || 'Unlinked'}</div>
                                <div className="break-all text-xs text-slate-500">{customer?.email || '-'}</div>
                              </td>
                              <td className="px-4 py-3">
                                {row.booking_id ? (
                                  <Link
                                    to={`/admin/bookings/${row.booking_id}`}
                                    className="font-semibold text-amber-700 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {dateTime(row.bookings?.start_time)}
                                  </Link>
                                ) : (
                                  <span className="text-slate-500">Not linked</span>
                                )}
                              </td>
                              <td className="px-4 py-3 font-semibold">{money(row.amount, row.currency)}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusClass(row.status)}`}>
                                  {label(row.status)}
                                </span>
                              </td>
                              <td className="px-4 py-3">{label(row.reason)}</td>
                              <td className="px-4 py-3">
                                <div>{dateTime(row.evidence_due_by)}</div>
                                <div className="text-xs font-semibold text-amber-700">{deadlineCountdown(row.evidence_due_by)}</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                }
                mobile={
                  <div className="space-y-3 p-3">
                    {items.map((row) => {
                      const customer = row.bookings?.customers;
                      return (
                        <MobileAdminCard
                          key={row.id}
                          className={selectedId === row.id ? 'border-amber-400 bg-amber-50/60' : undefined}
                          title={customer?.full_name || 'Unlinked'}
                          subtitle={customer?.email || undefined}
                          badge={
                            <StatusBadge tone={row.status === 'won' ? 'success' : row.status === 'lost' ? 'danger' : 'warning'}>
                              {humanizeLabel(row.status)}
                            </StatusBadge>
                          }
                          fields={[
                            { label: 'Amount', value: <span className="font-semibold">{money(row.amount, row.currency)}</span> },
                            { label: 'Reason', value: humanizeLabel(row.reason) },
                            {
                              label: 'Trip',
                              value: row.booking_id ? (
                                <Link
                                  to={`/admin/bookings/${row.booking_id}`}
                                  className="font-semibold text-amber-700 underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {dateTime(row.bookings?.start_time)}
                                </Link>
                              ) : (
                                'Not linked'
                              ),
                            },
                            {
                              label: 'Due',
                              value: (
                                <span>
                                  {dateTime(row.evidence_due_by)}
                                  <span className="mt-0.5 block text-xs font-semibold text-amber-700">
                                    {deadlineCountdown(row.evidence_due_by)}
                                  </span>
                                </span>
                              ),
                            },
                            {
                              label: 'Dispute',
                              value: (
                                <span className="font-mono text-xs" title={row.stripe_dispute_id}>
                                  {shortId(row.stripe_dispute_id, 12)}
                                </span>
                              ),
                            },
                          ]}
                          onClick={() => void loadDetail(row.id)}
                        />
                      );
                    })}
                  </div>
                }
              />
            )}
          </section>

          <aside className="rounded-2xl bg-white p-5 shadow">
            {!detail ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-slate-500">
                <Scale className="mb-3 h-10 w-10 text-slate-300" />
                <p>Select a dispute to view details and add notes.</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-black">Dispute Details</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusClass(detail.dispute.status)}`}>
                      {label(detail.dispute.status)}
                    </span>
                    {detail.dispute.evidence_due_by ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">
                        <Clock className="h-3 w-3" />
                        {deadlineCountdown(detail.dispute.evidence_due_by)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div><span className="font-bold">Amount:</span> {money(detail.dispute.amount, detail.dispute.currency)}</div>
                  <div><span className="font-bold">Reason:</span> {label(detail.dispute.reason)}</div>
                  <div>
                    <span className="font-bold">Stripe Dispute:</span>{' '}
                    <span className="font-mono text-xs" title={detail.dispute.stripe_dispute_id}>
                      {shortId(detail.dispute.stripe_dispute_id, 14)}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold">Charge:</span>{' '}
                    <span className="font-mono text-xs" title={detail.dispute.stripe_charge_id || undefined}>
                      {shortId(detail.dispute.stripe_charge_id, 14)}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold">Payment Intent:</span>{' '}
                    <span className="font-mono text-xs" title={detail.dispute.payment_intent_id || undefined}>
                      {shortId(detail.dispute.payment_intent_id, 14)}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold">Checkout Session:</span>{' '}
                    <span className="font-mono text-xs" title={detail.dispute.checkout_session_id || undefined}>
                      {shortId(detail.dispute.checkout_session_id, 14)}
                    </span>
                  </div>
                  <div><span className="font-bold">Evidence due:</span> {dateTime(detail.dispute.evidence_due_by)}</div>
                </div>

                {selectedCustomer ? (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Customer</h3>
                    <div className="mt-2 text-sm">
                      <div className="font-bold">{selectedCustomer.full_name || '-'}</div>
                      <div>{selectedCustomer.email || '-'}</div>
                      <div>{selectedCustomer.phone || '-'}</div>
                    </div>
                  </div>
                ) : null}

                {detail.dispute.booking_id ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/admin/bookings/${detail.dispute.booking_id}`}
                        className="inline-flex rounded-lg bg-amber-600 px-4 py-3 font-bold text-white hover:bg-amber-500"
                      >
                        Open Booking
                      </Link>
                      <button
                        type="button"
                        disabled={evidenceLoading}
                        onClick={() => void generateEvidence()}
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        <FileText className="h-4 w-4" />
                        {evidenceLoading ? 'Generating...' : 'Generate Evidence Summary'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={exportLoading != null}
                        onClick={() =>
                          void downloadExport(
                            `/api/admin/disputes/${encodeURIComponent(selectedId || '')}/evidence-pdf`,
                            `dispute-evidence-${selectedId?.slice(0, 8) || 'export'}.pdf`,
                            'pdf'
                          ).catch((err) =>
                            setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'PDF download failed.' })
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                      >
                        <Download className="h-4 w-4" />
                        {exportLoading === 'pdf' ? 'Downloading...' : 'Download Evidence PDF'}
                      </button>
                      <button
                        type="button"
                        disabled={exportLoading != null}
                        onClick={() =>
                          void downloadExport(
                            `/api/admin/disputes/${encodeURIComponent(selectedId || '')}/evidence-zip`,
                            `dispute-evidence-${selectedId?.slice(0, 8) || 'export'}.zip`,
                            'zip'
                          ).catch((err) =>
                            setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'ZIP download failed.' })
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                      >
                        <FileArchive className="h-4 w-4" />
                        {exportLoading === 'zip' ? 'Downloading...' : 'Download Evidence ZIP'}
                      </button>
                      <button
                        type="button"
                        disabled={exportLoading != null}
                        onClick={() => void submitStripeEvidence()}
                        className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-50"
                      >
                        <Upload className="h-4 w-4" />
                        {exportLoading === 'stripe' ? 'Submitting...' : 'Submit to Stripe'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>This dispute is not linked to a booking. Check Stripe charge / payment intent IDs manually.</span>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Admin Notes</h3>
                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                    {detail.notes.length === 0 ? (
                      <p className="text-sm text-slate-500">No notes yet.</p>
                    ) : (
                      detail.notes.map((note) => (
                        <div key={note.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                          <div className="whitespace-pre-wrap">{note.note_text}</div>
                          <div className="mt-1 text-xs text-slate-400">{dateTime(note.created_at)}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <textarea
                    className="mt-3 min-h-[100px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Add a dispute note..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !noteText.trim()}
                    onClick={() => void addNote()}
                    className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {busy ? 'Saving...' : 'Add Note'}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      {evidenceModalOpen ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Evidence Summary</h2>
                <p className="mt-1 text-sm text-slate-600">Generated from stored booking, payment, and communication records only.</p>
              </div>
              <button type="button" onClick={() => setEvidenceModalOpen(false)} className="rounded-lg bg-slate-100 px-3 py-2 font-bold text-slate-800">
                Close
              </button>
            </div>
            <textarea
              readOnly
              value={evidenceSummary}
              className="mt-5 min-h-[420px] w-full rounded-xl border border-slate-300 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => void copyEvidence()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 font-bold text-white">
                <Copy className="h-4 w-4" />
                Copy to Clipboard
              </button>
              <button type="button" onClick={() => setEvidenceModalOpen(false)} className="rounded-lg border border-slate-300 px-4 py-3 font-bold text-slate-800">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
