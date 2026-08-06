import { env } from '../config/env.js';
import { fetchJsonWithTimeout } from './adminDiagnostics';

export type OpsDashboardCounts = {
  newBookings: number;
  pendingApprovals: number;
  pendingWaivers: number;
  pendingInsurance: number;
  unreadMessages: number;
  paymentIssues: number;
  grouponPending: number;
  conflicts: number;
};

export type OpsNewBooking = {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  source_label: string;
  trip_type: string;
  start_time: string;
  end_time: string;
  passenger_count: number;
  boat_name: string;
  payment_status: string;
  status: string;
  created_at: string | null;
  readiness: string;
  is_new?: boolean;
};

export type OpsConflict = {
  type: string;
  label: string;
  booking_id: string;
  other_booking_id?: string;
  urgency: number;
};

export type OpsDashboardPayload = {
  generatedAt: string;
  lastReviewedAt: string;
  counts: OpsDashboardCounts;
  newBookings: OpsNewBooking[];
  conflicts: OpsConflict[];
  upcoming: { today: number; tomorrow: number; weekend: number; nextSevenDays: number };
  todaySchedule: OpsNewBooking[];
  todayTrips: OpsNewBooking[];
  actionRequired: Array<{ booking_id: string; type: string; label: string; customer_name: string }>;
  recentActivity: Array<{ id: string; booking_id?: string; event_type: string; message?: string; created_at: string }>;
  revenue?: Record<string, unknown>;
  weather?: Record<string, unknown>;
};

async function adminFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('API URL is not configured.');
  }
  return fetchJsonWithTimeout<T>(
    `ops-dashboard:${path}`,
    `${env.apiUrl}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    },
    25000
  );
}

export async function fetchOperationsDashboard(token: string) {
  return adminFetch<OpsDashboardPayload>(token, '/api/admin/operations-dashboard');
}

export async function markBookingReviewed(token: string, bookingId: string) {
  return adminFetch<{ ok: boolean; bookingId: string }>(
    token,
    '/api/admin/operations-dashboard/mark-reviewed',
    { method: 'POST', body: JSON.stringify({ bookingId }) }
  );
}

export async function markAllBookingsReviewed(token: string) {
  return adminFetch<{ ok: boolean; lastReviewedAt: string }>(
    token,
    '/api/admin/operations-dashboard/mark-all-reviewed',
    { method: 'POST', body: JSON.stringify({ confirm: true }) }
  );
}

export function formatRelativeTime(iso: string | null | undefined) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function sourceBadgeClass(sourceLabel: string) {
  const s = sourceLabel.toLowerCase();
  if (s.includes('groupon')) return 'bg-orange-100 text-orange-950';
  if (s.includes('staff')) return 'bg-violet-100 text-violet-950';
  return 'bg-cyan-100 text-cyan-950';
}
