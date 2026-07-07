import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Package, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import Logo from '../components/ui/Logo';
import { env } from '../config/env.js';

type ShopOrderRow = {
  id: string;
  order_number: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  quantity: number;
  amount_paid: number | string | null;
  currency: string;
  status: string;
  shipping_name: string | null;
  shipping_address: Record<string, string | null> | null;
  created_at: string;
  updated_at: string;
};

const STATUS_OPTIONS = [
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'refunded',
  'cancelled',
] as const;

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'delivered') return 'bg-green-100 text-green-800';
  if (s === 'processing' || s === 'shipped') return 'bg-blue-100 text-blue-800';
  if (s === 'refunded' || s === 'cancelled') return 'bg-red-100 text-red-800';
  if (s === 'pending') return 'bg-amber-100 text-amber-900';
  return 'bg-slate-100 text-slate-700';
}

function formatMoney(amount: number | string | null | undefined, currency = 'usd') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '-';
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

export default function AdminShopOrders() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<ShopOrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
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
  }, [apiRequest, isAdmin, statusFilter]);

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
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <p className="text-slate-700">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-slate-900 py-8 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Logo variant="admin" />
              <div>
                <h1 className="flex items-center gap-2 text-3xl font-bold">
                  <Package className="h-8 w-8 text-cyan-300" aria-hidden />
                  Shop Orders
                </h1>
                <p className="mt-1 text-slate-400">Observation Bottle fulfillment queue</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/admin"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Dashboard
              </Link>
              <Link
                to="/admin/bookings"
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-600"
              >
                Bookings
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
            <span className="font-semibold">Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">All</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
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
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      Loading shop orders…
                    </td>
                  </tr>
                ) : null}
                {!loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No shop orders yet.
                    </td>
                  </tr>
                ) : null}
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">{order.order_number}</td>
                    <td className="px-4 py-3 text-slate-800">
                      {order.customer_name || order.shipping_name || '-'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{order.email || '-'}</td>
                    <td className="px-4 py-3">{order.quantity}</td>
                    <td className="px-4 py-3 font-medium">{formatMoney(order.amount_paid, order.currency)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(order.created_at)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={order.status}
                        disabled={busyId === order.id}
                        onChange={(e) => void updateStatus(order, e.target.value)}
                        className={`rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold capitalize ${statusClass(order.status)}`}
                        aria-label={`Update status for order ${order.order_number}`}
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
