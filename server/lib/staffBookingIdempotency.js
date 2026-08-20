const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @returns {{ key: string } | { error: string } | null}
 */
function parseStaffIdempotencyKey(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const key = String(raw).trim().toLowerCase();
  if (!UUID_RE.test(key)) {
    return { error: 'idempotency_key must be a valid UUID.' };
  }
  return { key };
}

function isStaffIdempotencyUniqueViolation(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || err?.details || '').toLowerCase();
  return code === '23505' && (msg.includes('staff_idempotency') || msg.includes('idx_bookings_staff_idempotency'));
}

/**
 * @returns {Promise<{ booking: object, customer: object | null, duplicate: true } | { conflict: true } | null>}
 */
async function findStaffBookingReplay(supabase, key, adminUserId) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, customer_id, staff_created_by, staff_idempotency_key')
    .eq('staff_idempotency_key', key)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) return null;
  if (String(booking.staff_created_by || '') !== String(adminUserId || '')) {
    return { conflict: true };
  }
  let customer = null;
  if (booking.customer_id) {
    const { data: customerRow, error: customerError } = await supabase
      .from('customers')
      .select('id, full_name, email, phone')
      .eq('id', booking.customer_id)
      .maybeSingle();
    if (customerError) throw customerError;
    customer = customerRow;
  }
  return { booking, customer, duplicate: true };
}

module.exports = {
  parseStaffIdempotencyKey,
  isStaffIdempotencyUniqueViolation,
  findStaffBookingReplay,
};
