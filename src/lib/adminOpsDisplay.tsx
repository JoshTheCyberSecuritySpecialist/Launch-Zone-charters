export function timeLabel(start: string, end?: string) {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (!Number.isFinite(s.getTime())) return '-';
  return e && Number.isFinite(e.getTime())
    ? `${s.toLocaleTimeString([], opts)} - ${e.toLocaleTimeString([], opts)}`
    : s.toLocaleTimeString([], opts);
}

export function sourceLabel(value: string) {
  return String(value || 'website').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-bold ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
    >
      {label}: {ok ? 'OK' : 'Missing'}
    </span>
  );
}

export type OpsTodayTrip = {
  id: string;
  customer_name: string;
  boat_name: string;
  location?: string | null;
  start_time: string;
  end_time: string;
  passenger_count: number;
  payment_status: string;
  status?: string;
  booking_type?: string | null;
  booking_source: string;
  waiver_done: boolean;
  insurance_done: boolean;
  license_done: boolean;
  ready_for_departure: boolean;
};

export type OpsActionItem = {
  booking_id: string;
  customer_name: string;
  boat_name?: string;
  start_time?: string;
  type: string;
  label: string;
};

export type OpsScheduleBooking = {
  id: string;
  customer_name: string;
  start_time: string;
  end_time: string;
  status?: string;
  payment_status?: string;
};

export type OpsScheduleBoat = {
  id: string;
  name: string;
  bookings: OpsScheduleBooking[];
};

export type OpsBoatStatusRow = {
  id: string;
  name: string;
  status: string;
};

export type OpsRevenueSummary = {
  bookings: number;
  revenue: number;
  deposits: number;
  outstandingBalance: number;
  averageBookingValue: number;
};

export const EMPTY_OPS_REVENUE: OpsRevenueSummary = {
  bookings: 0,
  revenue: 0,
  deposits: 0,
  outstandingBalance: 0,
  averageBookingValue: 0,
};

export function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export function weatherDisplay(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
