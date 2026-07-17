import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2, ArrowLeft, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import AdminActions from '../components/admin/AdminActions';
import StatusBadge from '../components/admin/StatusBadge';
import { ADMIN_MOBILE_TOAST_CLASS, humanizeLabel } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';
import { fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

type PromoAppliesTo = 'all' | 'rentals' | 'charters' | 'groupon' | 'private';
type PromoDiscountType = 'percent' | 'fixed';

type PromoCodeRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: PromoDiscountType;
  discount_value: number;
  max_uses: number | null;
  used_count: number;
  active: boolean;
  applies_to: PromoAppliesTo;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type PromoFormState = {
  code: string;
  description: string;
  discount_type: PromoDiscountType;
  discount_value: string;
  max_uses: string;
  active: boolean;
  applies_to: PromoAppliesTo;
  starts_at: string;
  expires_at: string;
};

const PROMO_APPLIES_OPTIONS: { value: PromoAppliesTo; label: string }[] = [
  { value: 'all', label: 'All bookings' },
  { value: 'rentals', label: 'Rentals' },
  { value: 'charters', label: 'Charters' },
  { value: 'groupon', label: 'Groupon' },
  { value: 'private', label: 'Private charters' },
];

const blankPromoForm = (): PromoFormState => ({
  code: '',
  description: '',
  discount_type: 'percent',
  discount_value: '',
  max_uses: '',
  active: true,
  applies_to: 'all',
  starts_at: '',
  expires_at: '',
});

function isoToDateTimeLocal(value: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminPromoCodes() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [promoCodes, setPromoCodes] = useState<PromoCodeRow[]>([]);
  const [promoCodesLoading, setPromoCodesLoading] = useState(false);
  const [promoCodesError, setPromoCodesError] = useState<string | null>(null);
  const [promoForm, setPromoForm] = useState<PromoFormState>(() => blankPromoForm());
  const [promoEditingId, setPromoEditingId] = useState<string | null>(null);
  const [promoSaving, setPromoSaving] = useState(false);
  const [promoBusyId, setPromoBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);

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
        'Admin promo codes',
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

  const loadPromoCodes = useCallback(async () => {
    if (!isAdmin) return;
    setPromoCodesLoading(true);
    setPromoCodesError(null);
    try {
      const payload = await apiRequest<{ promoCodes?: PromoCodeRow[] }>('/api/admin/promo-codes');
      const rows = Array.isArray(payload.promoCodes) ? payload.promoCodes : [];
      setPromoCodes(rows);
    } catch (err) {
      console.error('[admin-promo-codes]', err);
      setPromoCodesError(err instanceof Error ? err.message : 'Could not load promo codes.');
      setPromoCodes([]);
    } finally {
      setPromoCodesLoading(false);
    }
  }, [apiRequest, isAdmin]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadPromoCodes();
  }, [authLoading, isAdmin, loadPromoCodes]);

  const resetPromoForm = useCallback(() => {
    setPromoEditingId(null);
    setPromoForm(blankPromoForm());
  }, []);

  const editPromoCode = useCallback((row: PromoCodeRow) => {
    setPromoEditingId(row.id);
    setPromoForm({
      code: row.code,
      description: row.description || '',
      discount_type: row.discount_type,
      discount_value: String(row.discount_value ?? ''),
      max_uses: row.max_uses == null ? '' : String(row.max_uses),
      active: Boolean(row.active),
      applies_to: row.applies_to || 'all',
      starts_at: isoToDateTimeLocal(row.starts_at),
      expires_at: isoToDateTimeLocal(row.expires_at),
    });
  }, []);

  const savePromoCode = useCallback(async () => {
    const code = promoForm.code.trim().toUpperCase();
    const discountValue = Number(promoForm.discount_value);
    if (!code) {
      setNotice({ variant: 'error', text: 'Promo code is required.' });
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      setNotice({ variant: 'error', text: 'Discount value must be a number.' });
      return;
    }
    setPromoSaving(true);
    try {
      const body = {
        code,
        description: promoForm.description.trim() || null,
        discount_type: promoForm.discount_type,
        discount_value: discountValue,
        max_uses: promoForm.max_uses.trim() ? Number(promoForm.max_uses) : null,
        active: promoForm.active,
        applies_to: promoForm.applies_to,
        starts_at: promoForm.starts_at || null,
        expires_at: promoForm.expires_at || null,
      };
      await apiRequest(
        promoEditingId ? `/api/admin/promo-codes/${encodeURIComponent(promoEditingId)}` : '/api/admin/promo-codes',
        {
          method: promoEditingId ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        }
      );
      setNotice({ variant: 'success', text: promoEditingId ? 'Promo code updated.' : 'Promo code created.' });
      resetPromoForm();
      await loadPromoCodes();
    } catch (err) {
      console.error('[admin-promo-save]', err);
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not save promo code.' });
    } finally {
      setPromoSaving(false);
    }
  }, [apiRequest, loadPromoCodes, promoEditingId, promoForm, resetPromoForm]);

  const setPromoActive = useCallback(
    async (row: PromoCodeRow, active: boolean) => {
      setPromoBusyId(row.id);
      try {
        await apiRequest(`/api/admin/promo-codes/${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ active }),
        });
        setNotice({ variant: 'success', text: active ? 'Promo code activated.' : 'Promo code deactivated.' });
        await loadPromoCodes();
      } catch (err) {
        console.error('[admin-promo-active]', err);
        setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not update promo code.' });
      } finally {
        setPromoBusyId(null);
      }
    },
    [apiRequest, loadPromoCodes]
  );

  const deactivatePromoCode = useCallback(
    async (row: PromoCodeRow) => {
      if (!window.confirm(`Delete promo code ${row.code} if unused? If it has been used, it will be deactivated instead.`)) return;
      setPromoBusyId(row.id);
      try {
        const payload = await apiRequest<{ deleted?: boolean }>(`/api/admin/promo-codes/${encodeURIComponent(row.id)}`, {
          method: 'DELETE',
        });
        setNotice({
          variant: 'success',
          text: payload.deleted ? 'Promo code deleted.' : 'Promo code deactivated.',
        });
        await loadPromoCodes();
      } catch (err) {
        console.error('[admin-promo-delete]', err);
        setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not delete promo code.' });
      } finally {
        setPromoBusyId(null);
      }
    },
    [apiRequest, loadPromoCodes]
  );

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }

  return (
    <AdminShell
      title="Promo Codes"
      subtitle="Manage checkout discount codes"
      actions={
        <>
          <Link
            to="/admin/bookings"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Bookings
          </Link>
          <button
            type="button"
            onClick={() => void loadPromoCodes()}
            disabled={promoCodesLoading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            {promoCodesLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </>
      }
    >
      {notice && (
        <div
          className={`${ADMIN_MOBILE_TOAST_CLASS} ${
            notice.variant === 'success' ? 'bg-green-700 text-white' : 'bg-red-700 text-white'
          }`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Promo Codes</h2>
            <p className="text-xs text-slate-500">
              Create discounts for checkout. Customers validate codes through the backend before Stripe starts.
            </p>
          </div>
        </div>
        <div className="grid gap-0 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <div className="border-b border-slate-100 p-4 lg:border-b-0 lg:border-r">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              {promoEditingId ? 'Edit code' : 'Create code'}
            </h3>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Code</span>
                <input
                  type="text"
                  value={promoForm.code}
                  onChange={(e) => setPromoForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
                  placeholder="VIP50"
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Description</span>
                <input
                  type="text"
                  value={promoForm.description}
                  onChange={(e) => setPromoForm((f) => ({ ...f, description: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  placeholder="Summer launch promo"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Type</span>
                  <select
                    value={promoForm.discount_type}
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, discount_type: e.target.value as PromoDiscountType }))
                    }
                    className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  >
                    <option value="percent">Percent</option>
                    <option value="fixed">Fixed $</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Value</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={promoForm.discount_value}
                    onChange={(e) => setPromoForm((f) => ({ ...f, discount_value: e.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    placeholder={promoForm.discount_type === 'percent' ? '50' : '25'}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Max uses</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={promoForm.max_uses}
                    onChange={(e) => setPromoForm((f) => ({ ...f, max_uses: e.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    placeholder="Optional"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Applies to</span>
                  <select
                    value={promoForm.applies_to}
                    onChange={(e) => setPromoForm((f) => ({ ...f, applies_to: e.target.value as PromoAppliesTo }))}
                    className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  >
                    {PROMO_APPLIES_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={promoForm.active}
                  onChange={(e) => setPromoForm((f) => ({ ...f, active: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Active
              </label>
              <div className="grid gap-3">
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Starts at</span>
                  <input
                    type="datetime-local"
                    value={promoForm.starts_at}
                    onChange={(e) => setPromoForm((f) => ({ ...f, starts_at: e.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Expires at</span>
                  <input
                    type="datetime-local"
                    value={promoForm.expires_at}
                    onChange={(e) => setPromoForm((f) => ({ ...f, expires_at: e.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void savePromoCode()}
                  disabled={promoSaving}
                  className="min-h-11 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                >
                  {promoSaving ? 'Saving...' : promoEditingId ? 'Save changes' : 'Create code'}
                </button>
                {promoEditingId && (
                  <button
                    type="button"
                    onClick={resetPromoForm}
                    className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>

          <AdminResponsiveList
            desktop={
              <div className="overflow-x-auto">
                {promoCodesLoading ? (
                  <p className="px-4 py-8 text-sm text-slate-500">Loading promo codes...</p>
                ) : promoCodesError ? (
                  <p className="px-4 py-8 text-sm text-red-600">{promoCodesError}</p>
                ) : promoCodes.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-slate-500">No promo codes yet.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <tr>
                        <th className="px-4 py-2">Code</th>
                        <th className="px-4 py-2">Discount</th>
                        <th className="px-4 py-2">Scope</th>
                        <th className="px-4 py-2">Uses</th>
                        <th className="px-4 py-2">Expires</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {promoCodes.map((row) => (
                        <tr key={row.id} className="align-top hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-mono font-bold text-slate-900">{row.code}</div>
                            {row.description && (
                              <div className="mt-1 max-w-xs text-xs text-slate-500">{row.description}</div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-800">
                            {row.discount_type === 'percent'
                              ? `${Number(row.discount_value).toFixed(2).replace(/\.00$/, '')}%`
                              : `$${Number(row.discount_value).toFixed(2)}`}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                            {PROMO_APPLIES_OPTIONS.find((option) => option.value === row.applies_to)?.label ||
                              row.applies_to}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                            {row.used_count}
                            {row.max_uses == null ? '' : ` / ${row.max_uses}`}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                            {row.expires_at ? new Date(row.expires_at).toLocaleDateString() : 'No expiration'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                row.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {row.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => editPromoCode(row)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={promoBusyId === row.id}
                              onClick={() => void setPromoActive(row, !row.active)}
                              className="ml-2 rounded-md px-2 py-1 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                            >
                              {row.active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              disabled={promoBusyId === row.id}
                              onClick={() => void deactivatePromoCode(row)}
                              className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            }
            mobile={
              <div className="space-y-3 p-3">
                {promoCodesLoading ? (
                  <p className="py-6 text-center text-sm text-slate-500">Loading promo codes...</p>
                ) : null}
                {promoCodesError ? (
                  <p className="py-6 text-center text-sm text-red-600">{promoCodesError}</p>
                ) : null}
                {!promoCodesLoading && !promoCodesError && promoCodes.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">No promo codes yet.</p>
                ) : null}
                {!promoCodesLoading && !promoCodesError
                  ? promoCodes.map((row) => (
                      <MobileAdminCard
                        key={`promo-m-${row.id}`}
                        title={row.code}
                        subtitle={row.description || undefined}
                        badge={
                          <StatusBadge tone={row.active ? 'success' : 'neutral'}>
                            {row.active ? 'Active' : 'Inactive'}
                          </StatusBadge>
                        }
                        fields={[
                          {
                            label: 'Discount',
                            value:
                              row.discount_type === 'percent'
                                ? `${Number(row.discount_value).toFixed(2).replace(/\.00$/, '')}%`
                                : `$${Number(row.discount_value).toFixed(2)}`,
                          },
                          {
                            label: 'Scope',
                            value:
                              PROMO_APPLIES_OPTIONS.find((option) => option.value === row.applies_to)?.label ||
                              humanizeLabel(row.applies_to),
                          },
                          {
                            label: 'Uses',
                            value: `${row.used_count}${row.max_uses == null ? '' : ` / ${row.max_uses}`}`,
                          },
                          {
                            label: 'Expires',
                            value: row.expires_at
                              ? new Date(row.expires_at).toLocaleDateString()
                              : 'No expiration',
                          },
                        ]}
                        actions={
                          <AdminActions>
                            <button
                              type="button"
                              onClick={() => editPromoCode(row)}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={promoBusyId === row.id}
                              onClick={() => void setPromoActive(row, !row.active)}
                              className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"
                            >
                              {row.active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              disabled={promoBusyId === row.id}
                              onClick={() => void deactivatePromoCode(row)}
                              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50 sm:col-span-2"
                            >
                              Delete
                            </button>
                          </AdminActions>
                        }
                      />
                    ))
                  : null}
              </div>
            }
          />
        </div>
      </div>
    </AdminShell>
  );
}
