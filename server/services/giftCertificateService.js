/**
 * Persist and load bioluminescence gift certificates (one row per ticket).
 * Table: public.gift_certificates — purchasing never consumes boat capacity.
 */

const GIFT_CERTIFICATE_STATUSES = Object.freeze(['active', 'redeemed', 'cancelled', 'refunded']);

function isMissingGiftCertificatesTable(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (msg.includes('gift_certificates') &&
      (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache')))
  );
}

function guestCountForPackage(pkg) {
  if (!pkg) return 1;
  if (String(pkg.id) === 'bio_private') return Number(pkg.maxGuests) || 5;
  return Number(pkg.guestCount) || 1;
}

/**
 * Insert one gift_certificates row per ticket after Stripe payment.
 * Idempotent on (stripe_checkout_session_id, ticket_index).
 */
async function persistGiftCertificatesFromPaidPayload(supabase, paidPayload, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !paidPayload || paidPayload.status !== 'paid') {
    return { inserted: 0, rows: [], skipped: true };
  }

  const tickets = Array.isArray(paidPayload.tickets) ? paidPayload.tickets : [];
  if (!tickets.length) {
    return { inserted: 0, rows: [], skipped: true };
  }

  const unitCents = Number(paidPayload.unitPriceCents) || 0;
  const seasonYear = Number(paidPayload.seasonYear) || 2027;
  const validFrom = String(paidPayload.seasonStart || `${seasonYear}-06-01`).slice(0, 10);
  const validUntil = String(paidPayload.seasonEnd || `${seasonYear}-10-31`).slice(0, 10);
  let guestCount = Number(paidPayload.guestCount);
  if (!Number.isFinite(guestCount) || guestCount < 1) {
    try {
      const { getBioluminescencePackage } = require('../config/bioluminescencePackages');
      guestCount = guestCountForPackage(getBioluminescencePackage(paidPayload.packageId));
    } catch {
      guestCount = String(paidPayload.packageId) === 'bio_private' ? 5 : 1;
    }
  }

  const rows = tickets.map((ticket, index) => {
    const code = String(ticket.code || '').trim().toUpperCase();
    return {
      gift_code: code,
      stripe_checkout_session_id: sid,
      stripe_payment_intent_id: paidPayload.stripePaymentIntentId || null,
      purchaser_name: paidPayload.purchaser?.fullName || null,
      purchaser_email: paidPayload.purchaser?.email || null,
      purchaser_phone: paidPayload.purchaser?.phone || null,
      from_name: ticket.fromName || paidPayload.fromName || null,
      recipient_name: ticket.recipientName || paidPayload.recipientName || 'Guest',
      recipient_email: ticket.recipientEmail || paidPayload.recipientEmail || null,
      gift_message: ticket.giftMessage || paidPayload.giftMessage || null,
      package_id: paidPayload.packageId,
      package_name: paidPayload.packageName || null,
      guest_count: guestCount,
      original_value_cents: unitCents,
      amount_paid_cents: unitCents,
      season_year: seasonYear,
      valid_from: validFrom,
      valid_until: validUntil,
      status: 'active',
      recipient_mode: paidPayload.recipientMode === 'different' ? 'different' : 'same',
      ticket_index: Number(ticket.index) || index + 1,
      redeemed_booking_id: null,
      redeemed_at: null,
      updated_at: new Date().toISOString(),
    };
  });

  const { data, error } = await supabase
    .from('gift_certificates')
    .upsert(rows, {
      onConflict: 'stripe_checkout_session_id,ticket_index',
      ignoreDuplicates: false,
    })
    .select('*');

  if (error) {
    if (isMissingGiftCertificatesTable(error)) {
      console.warn(
        '[gift-certificates] table missing — run migration 20261023053154_gift_certificates before gift rows persist.'
      );
      return { inserted: 0, rows: [], tableMissing: true };
    }
    console.error('[gift-certificates] upsert:', error.message || error);
    const err = new Error('Could not save gift certificates.');
    err.statusCode = 500;
    err.cause = error;
    throw err;
  }

  return {
    inserted: Array.isArray(data) ? data.length : rows.length,
    rows: data || [],
    tableMissing: false,
  };
}

function payloadFromGiftCertificateRows(rows, sessionId) {
  const list = Array.isArray(rows) ? [...rows] : [];
  if (!list.length) return null;
  list.sort((a, b) => Number(a.ticket_index || 0) - Number(b.ticket_index || 0));
  const first = list[0];
  const tickets = list.map((row) => ({
    index: Number(row.ticket_index) || 1,
    code: String(row.gift_code || '').toUpperCase(),
    recipientName: row.recipient_name || null,
    recipientEmail: row.recipient_email || null,
    giftMessage: row.gift_message || null,
    fromName: row.from_name || null,
    status: row.status || 'active',
    id: row.id || null,
  }));

  return {
    kind: 'bio_gift',
    status: 'paid',
    packageId: first.package_id || null,
    packageName: first.package_name || null,
    guestCount: Number(first.guest_count) || 1,
    ticketQuantity: tickets.length,
    recipientMode: first.recipient_mode === 'different' ? 'different' : 'same',
    tickets,
    ticketCodes: tickets.map((t) => t.code),
    unitPriceCents: Number(first.original_value_cents) || null,
    totalCents: list.reduce((sum, row) => sum + (Number(row.amount_paid_cents) || 0), 0),
    seasonYear: Number(first.season_year) || 2027,
    seasonStart: first.valid_from || null,
    seasonEnd: first.valid_until || null,
    recipientName: first.recipient_name || null,
    recipientEmail: first.recipient_email || null,
    giftMessage: first.gift_message || null,
    fromName: first.from_name || null,
    purchaser: {
      fullName: first.purchaser_name || null,
      email: first.purchaser_email || null,
      phone: first.purchaser_phone || null,
    },
    capacityConsumed: false,
    departureDate: null,
    stripePaymentIntentId: first.stripe_payment_intent_id || null,
    ticketEmailSentAt: first.confirmation_email_sent_at || null,
    source: 'gift_certificates',
    stripeCheckoutSessionId: sessionId || first.stripe_checkout_session_id || null,
  };
}

async function loadGiftCertificatesBySession(supabase, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { rows: [], tableMissing: false };

  const { data, error } = await supabase
    .from('gift_certificates')
    .select('*')
    .eq('stripe_checkout_session_id', sid)
    .order('ticket_index', { ascending: true });

  if (error) {
    if (isMissingGiftCertificatesTable(error)) {
      return { rows: [], tableMissing: true };
    }
    const err = new Error(error.message || 'Could not load gift certificates');
    err.statusCode = 500;
    throw err;
  }

  return { rows: data || [], tableMissing: false };
}

async function loadGiftCertificateByCode(supabase, giftCode) {
  const code = String(giftCode || '').trim().toUpperCase();
  if (!code) return { row: null, tableMissing: false };

  const { data, error } = await supabase
    .from('gift_certificates')
    .select('*')
    .eq('gift_code', code)
    .maybeSingle();

  if (error) {
    if (isMissingGiftCertificatesTable(error)) {
      return { row: null, tableMissing: true };
    }
    const err = new Error(error.message || 'Could not load gift certificate');
    err.statusCode = 500;
    throw err;
  }

  return { row: data || null, tableMissing: false };
}

async function markGiftCertificateEmailSent(supabase, sessionId, sentAt = new Date().toISOString()) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { updated: 0, tableMissing: false };

  const { data, error } = await supabase
    .from('gift_certificates')
    .update({
      confirmation_email_sent_at: sentAt,
      updated_at: sentAt,
    })
    .eq('stripe_checkout_session_id', sid)
    .is('confirmation_email_sent_at', null)
    .select('id');

  if (error) {
    if (isMissingGiftCertificatesTable(error)) {
      return { updated: 0, tableMissing: true };
    }
    console.warn('[gift-certificates] email stamp failed:', error.message || error);
    return { updated: 0, tableMissing: false };
  }

  return { updated: Array.isArray(data) ? data.length : 0, tableMissing: false };
}

/**
 * Conditional claim: only succeeds when status is still `active`.
 * Caller must roll back the booking if this returns ok:false.
 */
async function claimGiftCertificateRedemption(
  supabase,
  { giftCode, bookingId, redeemedAt = new Date().toISOString() } = {}
) {
  const code = String(giftCode || '')
    .trim()
    .toUpperCase();
  const bid = String(bookingId || '').trim();
  if (!code || !bid) {
    return { ok: false, code: 'gift_claim_invalid', message: 'Gift code and booking are required.' };
  }

  const { data, error } = await supabase
    .from('gift_certificates')
    .update({
      status: 'redeemed',
      redeemed_booking_id: bid,
      redeemed_at: redeemedAt,
      updated_at: redeemedAt,
    })
    .eq('gift_code', code)
    .eq('status', 'active')
    .select('id, gift_code, status, redeemed_booking_id, redeemed_at')
    .maybeSingle();

  if (error) {
    if (isMissingGiftCertificatesTable(error)) {
      return {
        ok: false,
        code: 'gift_table_missing',
        message: 'Gift certificates are not available yet.',
      };
    }
    console.error('[gift-certificates] redeem claim:', error.message || error);
    return {
      ok: false,
      code: 'gift_claim_failed',
      message: error.message || 'Could not redeem gift certificate.',
    };
  }

  if (!data) {
    return {
      ok: false,
      code: 'gift_already_redeemed',
      message: 'This gift ticket was just redeemed. Please use another ticket.',
    };
  }

  return { ok: true, row: data };
}

/**
 * Mark unpaid-redeem gift tickets as refunded after a Stripe refund.
 * Does not change already-redeemed rows (booking already consumes capacity).
 */
async function markGiftCertificatesRefunded(
  supabase,
  { paymentIntentId = null, checkoutSessionId = null, source = 'stripe_refund' } = {}
) {
  const pi = String(paymentIntentId || '').trim();
  const sid = String(checkoutSessionId || '').trim();
  if (!pi && !sid) {
    return { updated: 0, skippedRedeemed: 0, alreadyRefunded: 0, rows: [], tableMissing: false };
  }

  let lookup = supabase
    .from('gift_certificates')
    .select('id, gift_code, status, stripe_payment_intent_id, stripe_checkout_session_id');

  if (pi && sid) {
    lookup = lookup.or(
      `stripe_payment_intent_id.eq.${pi},stripe_checkout_session_id.eq.${sid}`
    );
  } else if (pi) {
    lookup = lookup.eq('stripe_payment_intent_id', pi);
  } else {
    lookup = lookup.eq('stripe_checkout_session_id', sid);
  }

  const { data: found, error: loadErr } = await lookup;
  if (loadErr) {
    if (isMissingGiftCertificatesTable(loadErr)) {
      return { updated: 0, skippedRedeemed: 0, alreadyRefunded: 0, rows: [], tableMissing: true };
    }
    console.error('[gift-certificates] refund lookup:', loadErr.message || loadErr);
    const err = new Error(loadErr.message || 'Could not look up gift certificates for refund.');
    err.statusCode = 500;
    throw err;
  }

  const rows = Array.isArray(found) ? found : [];
  if (!rows.length) {
    return { updated: 0, skippedRedeemed: 0, alreadyRefunded: 0, rows: [], tableMissing: false };
  }

  const skippedRedeemed = rows.filter((r) => String(r.status).toLowerCase() === 'redeemed');
  const alreadyRefunded = rows.filter((r) => String(r.status).toLowerCase() === 'refunded');
  const toRefund = rows.filter((r) => {
    const s = String(r.status || '').toLowerCase();
    return s === 'active' || s === 'cancelled';
  });

  if (!toRefund.length) {
    return {
      updated: 0,
      skippedRedeemed: skippedRedeemed.length,
      alreadyRefunded: alreadyRefunded.length,
      rows: [],
      skippedRedeemedRows: skippedRedeemed,
      tableMissing: false,
      source,
    };
  }

  const now = new Date().toISOString();
  const ids = toRefund.map((r) => r.id);
  const { data: updated, error: updErr } = await supabase
    .from('gift_certificates')
    .update({
      status: 'refunded',
      redeemed_booking_id: null,
      redeemed_at: null,
      updated_at: now,
    })
    .in('id', ids)
    .in('status', ['active', 'cancelled'])
    .select('id, gift_code, status');

  if (updErr) {
    if (isMissingGiftCertificatesTable(updErr)) {
      return { updated: 0, skippedRedeemed: 0, alreadyRefunded: 0, rows: [], tableMissing: true };
    }
    console.error('[gift-certificates] refund update:', updErr.message || updErr);
    const err = new Error(updErr.message || 'Could not mark gift certificates refunded.');
    err.statusCode = 500;
    throw err;
  }

  return {
    updated: Array.isArray(updated) ? updated.length : 0,
    skippedRedeemed: skippedRedeemed.length,
    alreadyRefunded: alreadyRefunded.length,
    rows: updated || [],
    skippedRedeemedRows: skippedRedeemed,
    tableMissing: false,
    source,
  };
}

module.exports = {
  GIFT_CERTIFICATE_STATUSES,
  isMissingGiftCertificatesTable,
  persistGiftCertificatesFromPaidPayload,
  payloadFromGiftCertificateRows,
  loadGiftCertificatesBySession,
  loadGiftCertificateByCode,
  markGiftCertificateEmailSent,
  claimGiftCertificateRedemption,
  markGiftCertificatesRefunded,
  guestCountForPackage,
};
