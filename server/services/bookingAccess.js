/**
 * Shared booking + customer verification for public document endpoints.
 */
const checkoutHoldService = require('./checkoutHoldService');

function normalizeEmailParam(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function phoneDigitsMatch(stored, provided) {
  const a = normalizePhoneDigits(stored);
  const b = normalizePhoneDigits(provided);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10)) return true;
  if (a.length >= 4 && b.length >= 4 && a.slice(-4) === b.slice(-4) && b.length <= 4) return true;
  return false;
}

function maskEmail(email) {
  const e = normalizeEmailParam(email);
  const at = e.indexOf('@');
  if (at <= 0) return '***';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const shown = local.length <= 1 ? '*' : `${local[0]}***`;
  return `${shown}@${domain}`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function loadBookingWithCustomer(supabase, bookingId) {
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select(
      `id, customer_id, boat_id, start_time, end_time, rental_type, captain_included, waiver_signed, license_status, insurance_status, license_url, insurance_url, booking_confirmation_sent_at, ${checkoutHoldService.UNPAID_HOLD_GATE_SELECT}, boats(id, name, type)`
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (bErr || !booking) {
    return { ok: false, statusCode: 404, message: 'Booking not found' };
  }
  if (checkoutHoldService.isUnpaidWebsiteCheckoutHold(booking)) {
    return { ok: false, statusCode: 404, message: 'Booking not found or no longer active' };
  }

  const { data: customer, error: cErr } = await supabase
    .from('customers')
    .select('id, full_name, email, phone, id_document_url, insurance_proof_url')
    .eq('id', booking.customer_id)
    .maybeSingle();

  if (cErr || !customer?.email) {
    return { ok: false, statusCode: 400, message: 'Could not verify customer' };
  }

  const boat = Array.isArray(booking.boats) ? booking.boats[0] : booking.boats;
  return { ok: true, booking, customer, boat };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function verifyBookingContact(supabase, bookingId, email, phone, opts = {}) {
  const loaded = await loadBookingWithCustomer(supabase, bookingId);
  if (!loaded.ok) return loaded;

  const emailNorm = normalizeEmailParam(email);
  if (emailNorm && normalizeEmailParam(loaded.customer.email) !== emailNorm) {
    return { ok: false, statusCode: 403, message: 'Email does not match this booking' };
  }
  if (!opts.requirePhone && !emailNorm) {
    return { ok: false, statusCode: 400, message: 'Email is required' };
  }

  if (opts.requirePhone) {
    const phoneStr = String(phone || '').trim();
    if (!phoneStr) {
      return { ok: false, statusCode: 400, message: 'Phone is required' };
    }
    if (!phoneDigitsMatch(loaded.customer.phone, phoneStr)) {
      return { ok: false, statusCode: 403, message: 'Phone does not match this booking' };
    }
  }

  return loaded;
}

module.exports = {
  normalizeEmailParam,
  phoneDigitsMatch,
  maskEmail,
  loadBookingWithCustomer,
  verifyBookingContact,
};
