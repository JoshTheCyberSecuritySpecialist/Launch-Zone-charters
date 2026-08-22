'use strict';

/**
 * Website Stripe checkout holds are real `bookings` rows used to reserve inventory
 * while Checkout is open. They must never look like paid operational bookings, and
 * abandoned/expired/failed checkout must release them without touching Groupon or staff.
 */

function asIso(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function sessionIdOf(row) {
  return String(row?.stripe_checkout_session_id || row?.checkout_session_id || '').trim();
}

function isPaidLike(row) {
  if (!row) return false;
  if (row.stripe_payment_id) return true;
  if (row.payment_intent_id) return true;
  const paid = Number(row.deposit_paid ?? row.amount_collected ?? 0);
  if (Number.isFinite(paid) && paid > 0) return true;
  const paymentStatus = String(row.payment_status || '').toLowerCase();
  return paymentStatus === 'paid' || paymentStatus === 'deposit_paid';
}

function isProtectedBookingSource(row) {
  const source = String(row?.booking_source || '').trim().toLowerCase();
  if (source === 'groupon' || source === 'admin') return true;
  return Boolean(row?.staff_created);
}

function isUnpaidWebsiteCheckoutHold(row) {
  if (!row || typeof row !== 'object') return false;
  if (isProtectedBookingSource(row)) return false;
  if (isPaidLike(row)) return false;
  if (!sessionIdOf(row)) return false;
  const status = String(row.status || '').trim().toLowerCase();
  return status === 'pending';
}

function isExpiredCheckoutHold(row, now = Date.now()) {
  if (!isUnpaidWebsiteCheckoutHold(row)) return false;
  const exp = row.expires_at ? new Date(String(row.expires_at)).getTime() : NaN;
  return Number.isFinite(exp) && exp < now;
}

function shouldHideFromOperationsCalendar(row, now = Date.now()) {
  if (!row) return false;
  if (isProtectedBookingSource(row) || isPaidLike(row)) return false;
  if (!sessionIdOf(row)) return false;
  const status = String(row.status || '').trim().toLowerCase();
  if (status === 'cancelled' && String(row.admin_notes || '').includes('Checkout hold')) return true;
  return isExpiredCheckoutHold(row, now);
}

function cancelPatch(reason, nowIso) {
  const stamp = nowIso || asIso();
  const note = `[${stamp}] Auto-cancelled unpaid website checkout hold (${reason}).`;
  return {
    status: 'cancelled',
    payment_status: 'pending',
    admin_notes: note,
  };
}

function holdMatchesSession(row, sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return false;
  return sessionIdOf(row) === id;
}

async function releaseUnpaidCheckoutHold(supabase, { sessionId, bookingId, reason, now } = {}) {
  if (!supabase) return { released: 0, ids: [] };
  if (!String(sessionId || '').trim() && !String(bookingId || '').trim()) {
    return { released: 0, ids: [] };
  }
  const why = String(reason || 'checkout_abandoned').trim() || 'checkout_abandoned';
  const stamp = asIso(now);
  let query = supabase
    .from('bookings')
    .select(
      'id, status, payment_status, booking_source, staff_created, stripe_checkout_session_id, checkout_session_id, stripe_payment_id, payment_intent_id, deposit_paid, amount_collected, expires_at, admin_notes'
    )
    .eq('status', 'pending')
    .is('stripe_payment_id', null);
  if (bookingId) query = query.eq('id', bookingId);
  if (sessionId) {
    query = query.or(
      [`stripe_checkout_session_id.eq.${sessionId}`, `checkout_session_id.eq.${sessionId}`].join(',')
    );
  }
  const { data, error } = await query;
  if (error) {
    console.warn('[checkout-hold-release] select:', error.message);
    return { released: 0, ids: [], error };
  }

  const ids = [];
  for (const row of data || []) {
    if (!isUnpaidWebsiteCheckoutHold(row)) continue;
    if (sessionId && !holdMatchesSession(row, sessionId)) continue;
    const existingNotes = String(row.admin_notes || '').trim();
    const patch = cancelPatch(why, stamp);
    patch.admin_notes = existingNotes ? `${existingNotes}\n${patch.admin_notes}` : patch.admin_notes;
    const { error: updErr } = await supabase.from('bookings').update(patch).eq('id', row.id);
    if (updErr) {
      console.warn('[checkout-hold-release] update:', row.id, updErr.message);
      continue;
    }
    ids.push(row.id);
  }
  return { released: ids.length, ids };
}

async function cleanupExpiredCheckoutHolds(supabase, now = Date.now()) {
  if (!supabase) return { cancelled: 0, ids: [] };
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, status, payment_status, booking_source, staff_created, stripe_checkout_session_id, checkout_session_id, stripe_payment_id, payment_intent_id, deposit_paid, amount_collected, expires_at, admin_notes'
    )
    .eq('status', 'pending')
    .is('stripe_payment_id', null)
    .not('expires_at', 'is', null)
    .lt('expires_at', asIso(now));
  if (error) {
    console.warn('[checkout-hold-cleanup] select:', error.message);
    return { cancelled: 0, ids: [], error };
  }

  const ids = [];
  for (const row of data || []) {
    if (!isExpiredCheckoutHold(row, now instanceof Date ? now.getTime() : now)) continue;
    const result = await releaseUnpaidCheckoutHold(supabase, {
      bookingId: row.id,
      sessionId: sessionIdOf(row),
      reason: 'expired_checkout_hold',
      now,
    });
    ids.push(...result.ids);
  }
  if (ids.length > 0) {
    console.log('[booking-hold-cleanup] cancelled', ids.length, 'expired website checkout hold(s)');
  }
  return { cancelled: ids.length, ids };
}

module.exports = {
  isUnpaidWebsiteCheckoutHold,
  isExpiredCheckoutHold,
  isProtectedBookingSource,
  shouldHideFromOperationsCalendar,
  releaseUnpaidCheckoutHold,
  cleanupExpiredCheckoutHolds,
};
