import { env } from '../config/env.js';
import { adminDebugLog, fetchJsonWithTimeout } from './adminDiagnostics';
import {
  buildOperationsDashboardDeltaPath,
  buildOperationsDashboardPath,
  normalizeOpsFilterFromApi,
  normalizeOpsSortFromApi,
  type OpsDashboardDeltaQueryParams,
  type OpsDashboardQueryParams,
  type OpsDashboardSort,
} from './adminOpsDashboardQuery';

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

export type OpsReadinessStatus = {
  overall: string;
  payment: string;
  waiver: string;
  insurance: string;
  captain: string;
  boat: string;
};

export type OpsConflictDetail = {
  type: string;
  message: string;
  overlappingBookingId: string | null;
  overlappingCustomerDisplayName: string | null;
  overlappingStart?: string | null;
  overlappingEnd?: string | null;
};

export type OpsNewBookingCard = {
  id: string;
  bookingId: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  source_label: string;
  scheduledStart: string;
  scheduledEnd: string;
  tripEndAt?: string | null;
  opsEligible?: boolean;
  businessTimezone: string;
  tripDateLong: string;
  tripDateCompact: string;
  relativeDateLabel: string | null;
  scheduledTimeDisplay: string;
  groupDateKey: string;
  serviceName: string;
  trip_type: string;
  charterMode: string;
  passenger_count: number;
  capacityText: string;
  boatDisplay: string;
  boatMissing: boolean;
  captainDisplay: string;
  captainMissing: boolean;
  departureDisplay: string;
  payment_status: string;
  status: string;
  created_at: string | null;
  is_new: boolean;
  conflictStatus: string;
  conflictDetails: OpsConflictDetail[];
  sameDayContext: string | null;
  turnaroundWarning: string | null;
  readinessStatus: OpsReadinessStatus;
  start_time: string;
  end_time: string;
};

export type OpsNewBookingGroup = {
  groupKey: string;
  headerRelative: string | null;
  headerDate: string;
  bookings: OpsNewBookingCard[];
};

/** @deprecated use OpsNewBookingCard — kept for schedule slices */
export type OpsNewBooking = OpsNewBookingCard;

export type OpsConflict = {
  type: string;
  label: string;
  booking_id: string;
  other_booking_id?: string;
  urgency: number;
};

export type OpsDashboardPayload = {
  generatedAt: string;
  businessTimezone: string;
  sort: string;
  filter: string | null;
  lastReviewedAt: string;
  counts: OpsDashboardCounts;
  newBookings: OpsNewBookingCard[];
  newBookingsGrouped: OpsNewBookingGroup[];
  conflicts: OpsConflict[];
  upcoming: { today: number; tomorrow: number; weekend: number; nextSevenDays: number };
  todaySchedule: OpsNewBookingCard[];
  todayTrips: OpsNewBookingCard[];
  actionRequired: Array<{ booking_id: string; type: string; label: string; customer_name: string }>;
  recentActivity: Array<{ id: string; booking_id?: string; event_type: string; message?: string; created_at: string }>;
  revenue?: Record<string, unknown>;
  weather?: Record<string, unknown>;
};

export type OpsDashboardQuickCounts = {
  grouponPending: number;
  openPaymentRecovery: number;
  unreadMessages: number;
  pendingPreTrip: number;
};

export type OpsDashboardDeltaPayload = {
  changed: boolean;
  generatedAt: string;
  since: string;
  quickCounts?: OpsDashboardQuickCounts;
  counts?: OpsDashboardCounts;
  businessTimezone?: string;
  sort?: string;
  filter?: string | null;
  lastReviewedAt?: string;
  newBookings?: OpsNewBookingCard[];
  newBookingsGrouped?: OpsNewBookingGroup[];
  conflicts?: OpsConflict[];
  upcoming?: OpsDashboardPayload['upcoming'];
  todaySchedule?: OpsNewBookingCard[];
  todayTrips?: OpsNewBookingCard[];
  actionRequired?: OpsDashboardPayload['actionRequired'];
  alerts?: Array<{ booking_id: string; type: string; label: string; customer_name: string }>;
  schedule?: OpsDashboardPayload extends { schedule?: infer S } ? S : unknown;
  boatStatus?: unknown[];
};

export type OpsDashboardQuery = OpsDashboardQueryParams;

export { buildOperationsDashboardDeltaPath, buildOperationsDashboardPath, normalizeOpsFilterFromApi, normalizeOpsSortFromApi };
export type { OpsDashboardDeltaQueryParams };
export type { OpsDashboardSort, OpsDashboardFilter } from './adminOpsDashboardQuery';

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

export async function fetchOperationsDashboard(
  token: string,
  query?: OpsDashboardQueryParams,
  init?: RequestInit
) {
  const path = buildOperationsDashboardPath(query);
  return adminFetch<OpsDashboardPayload>(token, path, {
    cache: 'no-store',
    ...init,
  });
}

export async function fetchOperationsDashboardDelta(
  token: string,
  query: OpsDashboardDeltaQueryParams,
  init?: RequestInit
) {
  const path = buildOperationsDashboardDeltaPath(query);
  return adminFetch<OpsDashboardDeltaPayload>(token, path, {
    cache: 'no-store',
    ...init,
  });
}

/** Merge a delta poll response into the last full dashboard payload. */
export function mergeOperationsDashboardDelta(
  prev: OpsDashboardPayload,
  delta: OpsDashboardDeltaPayload
): OpsDashboardPayload {
  if (delta.changed) {
    return {
      ...prev,
      generatedAt: delta.generatedAt,
      businessTimezone: delta.businessTimezone ?? prev.businessTimezone,
      sort: delta.sort ?? prev.sort,
      filter: delta.filter ?? prev.filter,
      lastReviewedAt: delta.lastReviewedAt ?? prev.lastReviewedAt,
      counts: delta.counts ?? prev.counts,
      newBookings: delta.newBookings ?? prev.newBookings,
      newBookingsGrouped: delta.newBookingsGrouped ?? prev.newBookingsGrouped,
      conflicts: delta.conflicts ?? prev.conflicts,
      upcoming: delta.upcoming ?? prev.upcoming,
      todaySchedule: delta.todaySchedule ?? prev.todaySchedule,
      todayTrips: (delta.todayTrips ?? prev.todayTrips) as OpsDashboardPayload['todayTrips'],
      actionRequired: delta.actionRequired ?? prev.actionRequired,
    };
  }

  const counts = delta.quickCounts
    ? {
        ...prev.counts,
        unreadMessages: delta.quickCounts.unreadMessages,
        grouponPending: delta.quickCounts.grouponPending,
      }
    : prev.counts;

  return {
    ...prev,
    generatedAt: delta.generatedAt,
    counts,
  };
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

/** Defensive: hide ended trips if API ever returns them. */
export function isOpsNewBookingActive(
  booking: Pick<OpsNewBookingCard, 'opsEligible' | 'tripEndAt'>
): boolean {
  if (booking.opsEligible === false) return false;
  if (booking.tripEndAt) {
    const endMs = new Date(booking.tripEndAt).getTime();
    if (Number.isFinite(endMs) && endMs < Date.now()) return false;
  }
  return true;
}

export function filterActiveOpsBookingGroups(groups: OpsNewBookingGroup[]): OpsNewBookingGroup[] {
  return (groups || [])
    .map((group) => ({
      ...group,
      bookings: group.bookings.filter(isOpsNewBookingActive),
    }))
    .filter((group) => group.bookings.length > 0);
}

export function sourceBadgeClass(sourceLabel: string) {
  const s = sourceLabel.toLowerCase();
  if (s.includes('groupon')) return 'bg-orange-100 text-orange-950';
  if (s.includes('staff')) return 'bg-violet-100 text-violet-950';
  return 'bg-cyan-100 text-cyan-950';
}

export const OPS_FILTER_OPTIONS = [
  { id: '', label: 'All new' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'This week' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'new', label: 'New' },
  { id: 'conflict', label: 'Conflict' },
  { id: 'missing_boat', label: 'Missing boat' },
  { id: 'missing_captain', label: 'Missing captain' },
  { id: 'direct', label: 'Direct' },
  { id: 'groupon', label: 'Groupon' },
  { id: 'staff', label: 'Staff' },
] as const;

export const OPS_SORT_OPTIONS = [
  { id: 'trip_date', label: 'Trip date' },
  { id: 'recently_booked', label: 'Recently booked' },
  { id: 'customer_name', label: 'Customer name' },
] as const;
