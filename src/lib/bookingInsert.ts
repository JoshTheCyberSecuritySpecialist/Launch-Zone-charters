/**
 * Whitelisted insert payload for public.bookings — only these keys are sent to Supabase.
 * Typed from Database so client inserts stay aligned with `src/lib/supabase.ts`.
 */

import type { Database } from './supabase';

type BookingsRow = Database['public']['Tables']['bookings']['Row'];

export type BookingInsertPayload = Database['public']['Tables']['bookings']['Insert'];

/** Columns omitted when absent on older DBs (`special_requests` merged into admin_notes; waiver tracked via `waivers` row). */
type BookingInsertPayloadCompat = Omit<BookingInsertPayload, 'special_requests' | 'waiver_signed'>;

function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function roundDuration(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) {
      delete out[key];
    }
  }
  return out as T;
}

/** Postgres boolean must receive true/false — never a number (e.g. half of total). */
function toPgBool(v: unknown, field: string): boolean {
  if (v === true || v === false) return v;
  if (typeof v === 'number') {
    throw new Error(
      `[bookingInsert] ${field} must be boolean; got number (${v}). Check for a pricing/value mix-up.`
    );
  }
  return false;
}

/** Shape gathered in the UI before coercion — same columns as insert, no DB-only fields. */
export type BookingInsertSource = {
  customer_id: string;
  boat_id: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  rental_type: BookingsRow['rental_type'];
  captain_included: boolean;
  captain_fee: number;
  base_price: number;
  peak_surcharge: number;
  security_deposit: number;
  total_price: number;
  deposit_amount: number;
  deposit_paid: number;
  balance_due: number;
  payment_status: string;
  status: BookingsRow['status'];
  is_night_tour: boolean;
  is_rocket_tour: boolean;
  special_requests: string;
  waiver_signed: boolean;
  license_status: BookingsRow['license_status'];
  insurance_status: BookingsRow['insurance_status'];
  stripe_payment_id: string | null;
  admin_notes: string | null;
  license_url: string | null;
  insurance_url: string | null;
};

/** Builds the insert row: coerces numbers/bools; omits `special_requests` / `waiver_signed` if your DB lacks those columns (see `supabase/migrations/*_ensure_*.sql`). */
export function buildBookingInsertPayload(
  source: BookingInsertSource
): BookingInsertPayloadCompat {
  const raw: Record<string, unknown> = { ...source };

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- intentional integration debug
    console.log('📦 RAW BOOKING OBJECT:', raw);
  }

  const special = source.special_requests.trim();
  const adminNotesMerged =
    [special ? `Special requests: ${special}` : null, source.admin_notes]
      .filter((v): v is string => v != null && String(v).trim() !== '')
      .join('\n\n') || null;

  const clean = stripUndefined({
    customer_id: source.customer_id.trim(),
    boat_id: source.boat_id.trim(),
    start_time: source.start_time,
    end_time: source.end_time,
    duration_hours: roundDuration(Number(source.duration_hours)),
    rental_type: source.rental_type,
    captain_included: toPgBool(source.captain_included, 'captain_included'),
    captain_fee: roundMoney(Number(source.captain_fee)),
    base_price: roundMoney(Number(source.base_price)),
    peak_surcharge: roundMoney(Number(source.peak_surcharge)),
    security_deposit: roundMoney(Number(source.security_deposit)),
    total_price: roundMoney(Number(source.total_price)),
    deposit_amount: roundMoney(Number(source.deposit_amount)),
    deposit_paid: roundMoney(Number(source.deposit_paid)),
    balance_due: roundMoney(Number(source.balance_due)),
    payment_status: String(source.payment_status),
    status: source.status,
    is_night_tour: toPgBool(source.is_night_tour, 'is_night_tour'),
    is_rocket_tour: toPgBool(source.is_rocket_tour, 'is_rocket_tour'),
    stripe_payment_id: source.stripe_payment_id,
    admin_notes: adminNotesMerged,
    license_status: source.license_status,
    insurance_status: source.insurance_status,
    license_url: source.license_url,
    insurance_url: source.insurance_url,
  }) as BookingInsertPayloadCompat;

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- intentional integration debug
    console.log('✅ CLEAN BOOKING OBJECT:', clean);
  }

  return clean;
}
