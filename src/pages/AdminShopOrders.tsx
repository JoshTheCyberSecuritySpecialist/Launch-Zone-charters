import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import { env } from '../config/env.js';

type ShopOrderRow = {
  id: string;
  order_number: string;
  stripe_session_id: string | null;
  payment_intent_id: string | null;
  stripe_charge_id: string | null;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  quantity: number;
  amount_paid: number | string | null;
  currency: string;
  status: string;
  shipping_name: string | null;
  shipping_address: Record<string, string | null> | null;
  product_slug: string | null;
  confirmation_email_sent_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  canceled_at: string | null;
  abandoned_at: string | null;
  created_at: string;
  updated_at: string;
  is_paid?: boolean;
  is_unpaid?: boolean;
};

type AdminFilter =
  | 'queue'
  | 'all'
  | 'incomplete'
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'abandoned';

const FILTER_OPTIONS: { value: AdminFilter; label: string }[] = [
  { value: 'queue', label: 'Fulfillment queue (paid)' },
  { value: 'all', label: 'All orders' },
  { value: 'paid', label: 'Paid' },
  { value: 'incomplete', label: 'Incomplete checkout' },
  { value: 'abandoned', label: 'Abandoned' },
  { value: 'fulfilled', label: 'Fulfilled (shipped/delivered)' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_OPTIONS = [
  'incomplete',
  'pending',
  'abandoned',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'refunded',
  'cancelled',
] as const;

function statusClass(status: string, isUnpaid?: boolean) {
  if (isUnpaid) return 'bg-slate-200 text-slate-600 line-through decoration-slate-400';
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'delivered') return 'bg-green-100 text-green-800';
  if (s === 'processing' || s === 'shipped') return 'bg-blue-100 text-blue-800';
  if (s === 'refunded' || s === 'cancelled') return 'bg-red-100 text-red-800';
  if (s === 'abandoned' || s === 'incomplete' || s === 'pending') return 'bg-slate-100 text-slate-600';
  return 'bg-slate-100 text-slate-700';
}

function formatMoney(amount: number | string | null | undefined, currency = 'usd', isUnpaid?: boolean) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    return isUnpaid ? '$0.00 — unpaid' : '-';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(n);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '-';
}

function formatAddress(addr: Record<string, string | null> | null | undefined) {
  if (!addr) return '-';
  const parts = [
    addr.line1,
    addr.line2,
    [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
    addr.country,
  ].filter(Boolean);
  return parts.join(', ') || '-';
}

function OrderDetailPanel({ order }: { order: ShopOrderRow }) {
  return (
    <div className="grid gap-4 border-t border-slate-100 bg-slate-50/80 px-4 py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stripe</p>
        <dl className="mt-2 space-y-1 text-slate-700">
          <div>
            <dt className="inline font-medium">Checkout session: </dt>
            <dd className="inline font-mono text-xs break-all">{order.stripe_session_id || '-'}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Payment intent: </dt>
            <dd className="inline font-mono text-xs break-all">{order.payment_intent_id || '-'}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Charge: </dt>
            <dd className="inline font-mono text-xs break-all">{order.stripe_charge_id || '-'}</dd>
          </div>
        </dl>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fulfillment</p>
        <dl className="mt-2 space-y-1 text-slate-700">
          <div>
            <dt className="inline font-medium">Product: </dt>
            <dd className="inline">{order.product_slug || '-'}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Phone: </dt>
            <dd className="inline">{order.phone || '-'}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Ship to: </dt>
            <dd className="inline">{order.shipping_name || order.customer_name || '-'}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Address: </dt>
            <dd className="inline">{formatAddress(order.shipping_address)}</dd>
          </div>
        </dl>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline</p>
        <dl className="mt-2 space-y-1 text-slate-700">
          <div>
            <dt className="inline font-medium">Created: </dt>
            <dd className="inline">{formatDate(order.created_at)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Paid: </dt>
            <dd className="inline">{formatDate(order.paid_at)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Fulfilled: </dt>
            <dd className="inline">{formatDate(order.fulfilled_at)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Abandoned: </dt>
            <dd className="inline">{formatDate(order.abandoned_at)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Confirmation email: </dt>
            <dd className="inline">{formatDate(order.confirmation_email_sent_at)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export default function AdminShopOrders() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<ShopOrderRow[]>([]);
  const [filter, setFilter] = useState<AdminFilter>('queue');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const loadOrders = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter });
      const payload = await apiRequest(`/api/admin/shop-orders?${params.toString()}`);
      setOrders(Array.isArray(payload.orders) ? payload.orders : []);
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof Error ? err.message : 'Could not load shop orders.',
      });
    } finally {
      setLoading(false);
    }
  }, [apiRequest, filter, isAdmin]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const updateStatus = async (order: ShopOrderRow, nextStatus: string) => {
    if (nextStatus === order.status) return;
    setBusyId(order.id);
    try {
      await apiRequest(`/api/admin/shop-orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setNotice({ variant: 'success', text: `Order ${order.order_number} updated to ${nextStatus}.` });
      await loadOrders();
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof Error ? err.message : 'Could not update order status.',
      });
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading) return <FullPageLoader />;
  if (!user || !isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} message="Admin access required." />;
  }

  return (
    <AdminShell
      title="Shop Orders"
      subtitle="Paid orders needing fulfillment — switch filter to see abandoned checkouts"
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

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="font-semibold">Show</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as AdminFilter)}
              className="rounded-md border border-slate-300 px-3 py-2"
            >
              {FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadOrders()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-3" aria-label="Expand" />
                  <th className="px-4 py-3">Order #</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Amount Paid</th>
                  <th className="px-4 py-3">Order Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Loading shop orders…
                    </td>
                  </tr>
                ) : null}
                {!loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      {filter === 'queue'
                        ? 'No paid orders in the fulfillment queue.'
                        : 'No shop orders match this filter.'}
                    </td>
                  </tr>
                ) : null}
                {orders.map((order) => {
                  const isUnpaid = order.is_unpaid ?? !order.is_paid;
                  const expanded = expandedId === order.id;
                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={`border-b border-slate-100 hover:bg-slate-50/80 ${
                          isUnpaid ? 'bg-slate-50/60 text-slate-500' : ''
                        }`}
                      >
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : order.id)}
                            className="rounded p-1 text-slate-500 hover:bg-slate-200"
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Collapse order details' : 'Expand order details'}
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" aria-hidden />
                            ) : (
                              <ChevronRight className="h-4 w-4" aria-hidden />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900">{order.order_number}</td>
                        <td className="px-4 py-3">
                          {isUnpaid ? (
                            <span className="italic text-slate-400">—</span>
                          ) : (
                            order.customer_name || order.shipping_name || '-'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isUnpaid ? (
                            <span className="italic text-slate-400">—</span>
                          ) : (
                            order.email || '-'
                          )}
                        </td>
                        <td className="px-4 py-3">{order.quantity}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-medium ${isUnpaid ? 'text-slate-400 line-through decoration-slate-300' : ''}`}
                          >
                            {formatMoney(order.amount_paid, order.currency, isUnpaid)}
                          </span>
                          {isUnpaid ? (
                            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                              Not paid
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(order.paid_at || order.created_at)}</td>
                        <td className="px-4 py-3">
                          <select
                            value={order.status}
                            disabled={busyId === order.id || isUnpaid}
                            onChange={(e) => void updateStatus(order, e.target.value)}
                            className={`rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold capitalize disabled:cursor-not-allowed disabled:opacity-60 ${statusClass(order.status, isUnpaid)}`}
                            aria-label={`Update status for order ${order.order_number}`}
                            title={isUnpaid ? 'Unpaid checkouts cannot be fulfilled' : undefined}
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <OrderDetailPanel order={order} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
    </AdminShell>
  );
}
