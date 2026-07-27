import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, RefreshCw, Upload } from 'lucide-react';
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

type ImportSummary = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateInFile: number;
  purchasedRows: number;
  redeemedRows: number;
  refundedRows: number;
  expiredRows: number;
  unmappedRows: number;
  mappedRows: number;
};

type PreviewRow = {
  rowNumber: number;
  voucherMasked: string;
  ownerName: string | null;
  dealName: string | null;
  optionName: string | null;
  sourceStatus: string | null;
  redeemedFlag: string | null;
  category: string;
  mapped: boolean;
  mappingLabel: string | null;
  duplicateInFile: boolean;
  valid: boolean;
  errors: string[];
};

type ImportBatch = {
  id: string;
  filename: string | null;
  status: string;
  row_count: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  duplicate_in_file_count: number;
  unmapped_count: number;
  created_at: string;
  confirmed_at: string | null;
};

type DealMapping = {
  id: string;
  deal_name: string;
  option_name: string;
  booking_type: 'rental' | 'charter';
  charter_type: string | null;
  rental_type: string | null;
  rental_location: string | null;
  covered_guest_count: number;
  service_label: string;
  active: boolean;
};

type VoucherRow = {
  id: string;
  voucherMasked: string;
  owner_name: string | null;
  merchant_reference_id: string | null;
  source_status: string | null;
  local_status: string;
  redeemed_flag: string | null;
  expires_at: string | null;
  deal_name: string | null;
  option_name: string | null;
  booking_id: string | null;
  review_flags: string[];
  groupon_deal_option_mappings?: {
    service_label: string;
    covered_guest_count: number;
  } | null;
};

type Tab = 'import' | 'mappings' | 'vouchers';

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';
const labelClass = 'mb-1 block text-sm font-semibold text-slate-700';
const buttonPrimary =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-base font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60';
const buttonSecondary =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-bold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60';

function formatWhen(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleString();
}

export default function AdminGroupon() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('import');
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [previewSummary, setPreviewSummary] = useState<ImportSummary | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [imports, setImports] = useState<ImportBatch[]>([]);

  const [mappings, setMappings] = useState<DealMapping[]>([]);
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [voucherSearch, setVoucherSearch] = useState('');
  const [voucherLastFour, setVoucherLastFour] = useState('');

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
    async <T = Record<string, unknown>>(path: string, init: RequestInit = {}, timeoutMs = 180000): Promise<T> => {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        throw new Error('API server URL is not configured (set VITE_API_URL).');
      }
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session unavailable.');
      return fetchJsonWithTimeout<T>(
        'Admin Groupon',
        `${env.apiUrl}${path}`,
        {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init.headers || {}),
          },
        },
        timeoutMs
      );
    },
    [getAdminToken]
  );

  const loadImports = useCallback(async () => {
    const payload = await apiRequest<{ imports: ImportBatch[] }>('/api/admin/groupon-imports');
    setImports(payload.imports || []);
  }, [apiRequest]);

  const loadMappings = useCallback(async () => {
    const payload = await apiRequest<{ mappings: DealMapping[] }>('/api/admin/groupon-deal-mappings');
    setMappings(payload.mappings || []);
  }, [apiRequest]);

  const loadVouchers = useCallback(async () => {
    const params = new URLSearchParams();
    if (voucherSearch.trim()) params.set('search', voucherSearch.trim());
    if (voucherLastFour.trim()) params.set('lastFour', voucherLastFour.trim());
    const qs = params.toString();
    const payload = await apiRequest<{ vouchers: VoucherRow[] }>(
      `/api/admin/groupon-vouchers${qs ? `?${qs}` : ''}`
    );
    setVouchers(payload.vouchers || []);
  }, [apiRequest, voucherLastFour, voucherSearch]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadImports().catch((err) =>
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load imports.' })
    );
    void loadMappings().catch(() => setMappings([]));
  }, [isAdmin, loadImports, loadMappings]);

  useEffect(() => {
    if (!isAdmin || tab !== 'vouchers') return;
    void loadVouchers().catch((err) =>
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load vouchers.' })
    );
  }, [isAdmin, loadVouchers, tab]);

  const previewStats = useMemo(() => {
    if (!previewSummary) return null;
    return [
      { label: 'Total rows', value: previewSummary.totalRows },
      { label: 'Valid', value: previewSummary.validRows },
      { label: 'Invalid', value: previewSummary.invalidRows },
      { label: 'Duplicates in file', value: previewSummary.duplicateInFile },
      { label: 'Unmapped options', value: previewSummary.unmappedRows },
      { label: 'Purchased', value: previewSummary.purchasedRows },
      { label: 'Redeemed', value: previewSummary.redeemedRows },
      { label: 'Refunded', value: previewSummary.refundedRows },
    ];
  }, [previewSummary]);

  async function recoverPendingPreviewBatch(filename?: string | null) {
    const payload = await apiRequest<{ imports: ImportBatch[] }>('/api/admin/groupon-imports');
    const pending = (payload.imports || []).find(
      (row) =>
        row.status === 'preview' &&
        (!filename || row.filename === filename)
    );
    if (!pending?.id) return null;
    setPreviewBatchId(pending.id);
    const detail = await apiRequest<{ importBatch: ImportBatch & { summary?: { previewSummary?: ImportSummary } } }>(
      `/api/admin/groupon-imports/${pending.id}`
    );
    const summary = detail.importBatch?.summary?.previewSummary;
    if (summary) setPreviewSummary(summary);
    return pending.id;
  }

  async function handleConfirmImport(batchId = previewBatchId) {
    if (!batchId) return;
    if (!window.confirm('Import these Groupon vouchers into production records?')) return;
    setBusy(true);
    setNotice(null);
    try {
      const payload = await apiRequest<{ summary: Record<string, number> }>(
        `/api/admin/groupon-imports/${batchId}/confirm`,
        { method: 'POST', body: JSON.stringify({}) },
        300000
      );
      setNotice({
        variant: 'success',
        text: `Import complete. Inserted ${payload.summary.inserted}, updated ${payload.summary.updated}, skipped ${payload.summary.skipped}.`,
      });
      setPreviewBatchId(null);
      setPreviewSummary(null);
      setPreviewRows([]);
      setSelectedFile(null);
      await Promise.all([loadImports(), loadVouchers(), loadMappings()]);
      setTab('vouchers');
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof Error ? err.message : 'Could not confirm Groupon import.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview() {
    if (!selectedFile) {
      setNotice({ variant: 'error', text: 'Choose a Groupon CSV export first.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const csvText = await selectedFile.text();
      const payload = await apiRequest<{
        importBatch: ImportBatch;
        summary: ImportSummary;
        rows: PreviewRow[];
        headers: string[];
        rowsReturned?: number;
        totalRows?: number;
      }>(
        '/api/admin/groupon-imports/preview',
        {
          method: 'POST',
          body: JSON.stringify({ csvText, filename: selectedFile.name }),
        },
        180000
      );
      setPreviewBatchId(payload.importBatch.id);
      setPreviewSummary(payload.summary);
      setPreviewRows(payload.rows || []);
      setPreviewHeaders(payload.headers || []);
      const truncated =
        typeof payload.totalRows === 'number' &&
        typeof payload.rowsReturned === 'number' &&
        payload.totalRows > payload.rowsReturned;
      setNotice({
        variant: 'success',
        text: truncated
          ? `Import preview ready (${payload.rowsReturned} of ${payload.totalRows} rows shown). Confirm import when ready.`
          : 'Import preview ready. Review rows, then confirm import.',
      });
      await loadImports();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not preview Groupon import.';
      if (/timed out/i.test(message)) {
        try {
          const recoveredId = await recoverPendingPreviewBatch(selectedFile.name);
          if (recoveredId) {
            setNotice({
              variant: 'success',
              text: 'Preview took longer than expected, but the server saved it. You can confirm import now.',
            });
            await loadImports();
            return;
          }
        } catch {
          // fall through to original error
        }
      }
      setNotice({ variant: 'error', text: message });
    } finally {
      setBusy(false);
    }
  }

  async function downloadErrorReport(batchId: string) {
    const token = await getAdminToken();
    if (!token || !env.apiUrl) return;
    const res = await fetch(`${env.apiUrl}/api/admin/groupon-imports/${batchId}/error-report`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Could not download error report.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `groupon-import-errors-${batchId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) return <AdminAccessDenied signedIn={Boolean(user)} />;

  return (
    <AdminShell
      title="Groupon Vouchers"
      mobileTitle="Groupon"
      subtitle="Import reports, manage deal mappings, review vouchers"
      hideSubtitleOnMobile
    >
      <p className="mb-4 text-base text-slate-600">
        <Link to="/admin/more" className="inline-flex items-center gap-2 font-bold text-amber-800 underline">
          <ArrowLeft className="h-4 w-4" />
          Back to More Tools
        </Link>
      </p>

      {notice ? (
        <div
          className={`mb-4 rounded-xl px-4 py-3 text-base font-semibold ${
            notice.variant === 'success' ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
          } ${ADMIN_MOBILE_TOAST_CLASS}`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        {([
          ['import', 'Import CSV'],
          ['mappings', 'Deal Mappings'],
          ['vouchers', 'Vouchers'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`min-h-12 rounded-xl px-4 py-3 text-base font-bold ${
              tab === key ? 'bg-amber-700 text-white' : 'border border-slate-300 bg-white text-slate-800'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'import' ? (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-xl font-bold text-slate-900">Upload Groupon CSV</h2>
            <p className="mb-4 text-base text-slate-600">
              Upload a Groupon voucher export. The file is parsed on the server and never stored permanently.
            </p>
            <label className={labelClass}>CSV file</label>
            <input
              className={`${inputClass} mb-4`}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            <div className="flex flex-wrap gap-3">
              <button type="button" className={buttonPrimary} disabled={busy || !selectedFile} onClick={() => void handlePreview()}>
                <Upload className="h-5 w-5" />
                Preview import
              </button>
              {previewBatchId ? (
                <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void handleConfirmImport()}>
                  Confirm import
                </button>
              ) : null}
            </div>
            {previewBatchId ? (
              <p className="mt-3 text-sm font-semibold text-emerald-800">
                Preview batch ready. Confirm import to write vouchers to the database.
              </p>
            ) : null}
          </section>

          {previewStats ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-xl font-bold text-slate-900">Preview summary</h2>
              {previewHeaders.length ? (
                <p className="mb-3 text-sm text-slate-600">
                  Detected headers: {previewHeaders.slice(0, 6).join(', ')}
                  {previewHeaders.length > 6 ? '…' : ''}
                </p>
              ) : null}
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {previewStats.map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-slate-600">{stat.label}</div>
                    <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
                  </div>
                ))}
              </div>
              <AdminResponsiveList
                desktop={
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                        <tr>
                          <th className="px-4 py-2">Row</th>
                          <th className="px-4 py-2">Voucher</th>
                          <th className="px-4 py-2">Owner</th>
                          <th className="px-4 py-2">Option</th>
                          <th className="px-4 py-2">Status</th>
                          <th className="px-4 py-2">Mapping</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previewRows.slice(0, 100).map((row) => (
                          <tr key={row.rowNumber} className={row.valid ? '' : 'bg-red-50'}>
                            <td className="px-4 py-3">{row.rowNumber}</td>
                            <td className="px-4 py-3 font-mono">{row.voucherMasked}</td>
                            <td className="px-4 py-3">{row.ownerName || '—'}</td>
                            <td className="px-4 py-3">{row.optionName || '—'}</td>
                            <td className="px-4 py-3">
                              <StatusBadge>{humanizeLabel(row.category)}</StatusBadge>
                              {!row.valid ? <div className="mt-1 text-xs text-red-700">{row.errors.join('; ')}</div> : null}
                            </td>
                            <td className="px-4 py-3">{row.mappingLabel || (row.mapped ? 'Mapped' : 'Unmapped')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
                mobile={
                  <div className="space-y-3">
                    {previewRows.slice(0, 100).map((row) => (
                      <MobileAdminCard
                        key={row.rowNumber}
                        title={row.voucherMasked}
                        subtitle={row.ownerName || 'Unknown owner'}
                        badge={<StatusBadge>{humanizeLabel(row.category)}</StatusBadge>}
                        fields={[
                          { label: 'Row', value: String(row.rowNumber) },
                          { label: 'Option', value: row.optionName || '—' },
                          { label: 'Mapping', value: row.mappingLabel || (row.mapped ? 'Mapped' : 'Unmapped') },
                          ...(row.errors.length ? [{ label: 'Errors', value: row.errors.join('; ') }] : []),
                        ]}
                      />
                    ))}
                  </div>
                }
              />
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-900">Import history</h2>
              <button type="button" className={buttonSecondary} onClick={() => void loadImports()}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
            <AdminResponsiveList
              desktop={
                <div className="overflow-x-auto">
                  {imports.length === 0 ? (
                    <p className="px-4 py-8 text-sm text-slate-500">No Groupon imports yet.</p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                        <tr>
                          <th className="px-4 py-2">When</th>
                          <th className="px-4 py-2">File</th>
                          <th className="px-4 py-2">Status</th>
                          <th className="px-4 py-2">Rows</th>
                          <th className="px-4 py-2">Result</th>
                          <th className="px-4 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {imports.map((row) => (
                          <tr key={row.id}>
                            <td className="px-4 py-3">{formatWhen(row.created_at)}</td>
                            <td className="px-4 py-3">{row.filename || '—'}</td>
                            <td className="px-4 py-3">
                              <StatusBadge tone={row.status === 'confirmed' ? 'success' : 'neutral'}>
                                {humanizeLabel(row.status)}
                              </StatusBadge>
                            </td>
                            <td className="px-4 py-3">{row.row_count}</td>
                            <td className="px-4 py-3 text-sm">
                              +{row.inserted_count} / ~{row.updated_count} / skip {row.skipped_count}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                {row.status === 'preview' ? (
                                  <button
                                    type="button"
                                    className="font-semibold text-emerald-800 underline"
                                    disabled={busy}
                                    onClick={() => {
                                      setPreviewBatchId(row.id);
                                      void handleConfirmImport(row.id);
                                    }}
                                  >
                                    Confirm import
                                  </button>
                                ) : null}
                                {row.error_count > 0 ? (
                                  <button
                                    type="button"
                                    className="font-semibold text-amber-800 underline"
                                    onClick={() =>
                                      void downloadErrorReport(row.id).catch(() =>
                                        setNotice({ variant: 'error', text: 'Could not download error report.' })
                                      )
                                    }
                                  >
                                    <Download className="mr-1 inline h-4 w-4" />
                                    Errors
                                  </button>
                                ) : row.status === 'preview' ? null : (
                                  '—'
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              }
              mobile={
                <div className="space-y-3">
                  {imports.map((row) => (
                    <MobileAdminCard
                      key={row.id}
                      title={row.filename || 'Groupon import'}
                      subtitle={formatWhen(row.created_at)}
                      badge={
                        <StatusBadge tone={row.status === 'confirmed' ? 'success' : 'neutral'}>
                          {humanizeLabel(row.status)}
                        </StatusBadge>
                      }
                      fields={[
                        { label: 'Rows', value: String(row.row_count) },
                        {
                          label: 'Result',
                          value: `+${row.inserted_count}, updated ${row.updated_count}, skipped ${row.skipped_count}`,
                        },
                      ]}
                    />
                  ))}
                </div>
              }
            />
          </section>
        </div>
      ) : null}

      {tab === 'mappings' ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-slate-900">Deal option mappings</h2>
            <button type="button" className={buttonSecondary} onClick={() => void loadMappings()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
          <p className="mb-4 text-base text-slate-600">
            Each Groupon deal + option name must map to an internal service before customers can book online.
          </p>
          <AdminResponsiveList
            desktop={
              <div className="overflow-x-auto">
                {mappings.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-slate-500">No deal mappings configured.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <tr>
                        <th className="px-4 py-2">Service</th>
                        <th className="px-4 py-2">Deal</th>
                        <th className="px-4 py-2">Option</th>
                        <th className="px-4 py-2">Guests</th>
                        <th className="px-4 py-2">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {mappings.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3 font-semibold">{row.service_label}</td>
                          <td className="px-4 py-3">{row.deal_name}</td>
                          <td className="px-4 py-3">{row.option_name}</td>
                          <td className="px-4 py-3">{row.covered_guest_count}</td>
                          <td className="px-4 py-3">
                            {row.booking_type}
                            {row.charter_type ? ` / ${row.charter_type}` : ''}
                            {row.rental_type ? ` / ${row.rental_type}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            }
            mobile={
              <div className="space-y-3">
                {mappings.map((row) => (
                  <MobileAdminCard
                    key={row.id}
                    title={row.service_label}
                    subtitle={row.option_name}
                    fields={[
                      { label: 'Deal', value: row.deal_name },
                      { label: 'Guests', value: String(row.covered_guest_count) },
                      {
                        label: 'Type',
                        value: [row.booking_type, row.charter_type, row.rental_type].filter(Boolean).join(' / '),
                      },
                    ]}
                  />
                ))}
              </div>
            }
          />
        </section>
      ) : null}

      {tab === 'vouchers' ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className={labelClass}>Search owner name</label>
              <input className={inputClass} value={voucherSearch} onChange={(e) => setVoucherSearch(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Voucher last 4</label>
              <input
                className={inputClass}
                value={voucherLastFour}
                onChange={(e) => setVoucherLastFour(e.target.value.toUpperCase())}
                maxLength={4}
              />
            </div>
            <div className="flex items-end">
              <button type="button" className={buttonPrimary} onClick={() => void loadVouchers()}>
                Search vouchers
              </button>
            </div>
          </div>
          <AdminResponsiveList
            desktop={
              <div className="overflow-x-auto">
                {vouchers.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-slate-500">No vouchers found.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <tr>
                        <th className="px-4 py-2">Voucher</th>
                        <th className="px-4 py-2">Owner</th>
                        <th className="px-4 py-2">Service</th>
                        <th className="px-4 py-2">Imported status</th>
                        <th className="px-4 py-2">Local status</th>
                        <th className="px-4 py-2">Expires</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vouchers.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3 font-mono">{row.voucherMasked}</td>
                          <td className="px-4 py-3">{row.owner_name || '—'}</td>
                          <td className="px-4 py-3">
                            {row.groupon_deal_option_mappings?.service_label || row.option_name || 'Unmapped'}
                          </td>
                          <td className="px-4 py-3">{humanizeLabel(row.source_status || '—')}</td>
                          <td className="px-4 py-3">
                            <StatusBadge>{humanizeLabel(row.local_status)}</StatusBadge>
                          </td>
                          <td className="px-4 py-3">{formatWhen(row.expires_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            }
            mobile={
              <div className="space-y-3">
                {vouchers.map((row) => (
                  <MobileAdminCard
                    key={row.id}
                    title={row.voucherMasked}
                    subtitle={row.owner_name || 'Unknown owner'}
                    badge={<StatusBadge>{humanizeLabel(row.local_status)}</StatusBadge>}
                    fields={[
                      {
                        label: 'Service',
                        value: row.groupon_deal_option_mappings?.service_label || row.option_name || 'Unmapped',
                      },
                      { label: 'Imported', value: row.source_status || '—' },
                      { label: 'Expires', value: formatWhen(row.expires_at) },
                    ]}
                  />
                ))}
              </div>
            }
          />
        </section>
      ) : null}
    </AdminShell>
  );
}
