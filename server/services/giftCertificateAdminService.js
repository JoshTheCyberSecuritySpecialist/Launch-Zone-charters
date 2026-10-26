/**
 * Admin list / status tools for bioluminescence gift certificates.
 */

const giftCertificateService = require('./giftCertificateService');
const { BIO_SEASONS, listOpenBioSeasons } = require('../config/bioluminescenceSeason');

const ADMIN_STATUS_FILTERS = Object.freeze([
  'all',
  'active',
  'redeemed',
  'cancelled',
  'refunded',
]);

const ADMIN_MUTABLE_STATUSES = Object.freeze(['cancelled', 'refunded', 'active']);

function isGiftSalesEnabled() {
  // Default ON when unset so the Gift CTA and checkout work after deploy.
  // Set BIO_GIFT_SALES_ENABLED=false explicitly to close the storefront.
  const raw = process.env.BIO_GIFT_SALES_ENABLED;
  if (raw == null || String(raw).trim() === '') return true;
  return String(raw).trim().toLowerCase() === 'true';
}

/** Public storefront / nav CTA — gated only by BIO_GIFT_SALES_ENABLED. */
function isGiftStorefrontOpen() {
  return isGiftSalesEnabled();
}

function giftPlatformSettings() {
  const seasons = Object.entries(BIO_SEASONS).map(([year, season]) => ({
    year: Number(year),
    bookingStart: season.bookingStart,
    bookingEnd: season.bookingEnd,
    salesOpen: season.salesOpen !== false,
  }));
  return {
    giftSalesEnabled: isGiftSalesEnabled(),
    giftStorefrontOpen: isGiftStorefrontOpen(),
    giftSalesEnv: 'BIO_GIFT_SALES_ENABLED',
    seasons,
    openSeasons: listOpenBioSeasons(),
    note:
      'Season windows live in server/config/bioluminescenceSeason.js. Gift sales default ON; set BIO_GIFT_SALES_ENABLED=false to close the storefront. Existing certificates remain redeemable when sales are off.',
  };
}

function adminRowView(row) {
  if (!row) return null;
  return {
    id: row.id,
    giftCode: row.gift_code,
    status: row.status,
    packageId: row.package_id,
    packageName: row.package_name,
    guestCount: Number(row.guest_count) || 1,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    fromName: row.from_name,
    giftMessage: row.gift_message,
    purchaserName: row.purchaser_name,
    purchaserEmail: row.purchaser_email,
    purchaserPhone: row.purchaser_phone,
    seasonYear: Number(row.season_year) || null,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    amountPaidCents: Number(row.amount_paid_cents) || 0,
    originalValueCents: Number(row.original_value_cents) || 0,
    ticketIndex: Number(row.ticket_index) || 1,
    recipientMode: row.recipient_mode,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    redeemedBookingId: row.redeemed_booking_id,
    redeemedAt: row.redeemed_at,
    confirmationEmailSentAt: row.confirmation_email_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listGiftCertificatesForAdmin(supabase, query = {}) {
  const status = String(query.status || 'all')
    .trim()
    .toLowerCase();
  const q = String(query.q || query.search || '')
    .trim()
    .toLowerCase();
  const seasonYearRaw = query.seasonYear ?? query.season_year;
  const seasonYear =
    seasonYearRaw != null && String(seasonYearRaw).trim() !== ''
      ? Number(seasonYearRaw)
      : null;
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 100));

  let builder = supabase
    .from('gift_certificates')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') {
    if (!ADMIN_STATUS_FILTERS.includes(status)) {
      const err = new Error(`Invalid status filter. Allowed: ${ADMIN_STATUS_FILTERS.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }
    builder = builder.eq('status', status);
  }

  if (Number.isFinite(seasonYear) && seasonYear > 0) {
    builder = builder.eq('season_year', seasonYear);
  }

  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    builder = builder.or(
      [
        `gift_code.ilike.${like}`,
        `purchaser_email.ilike.${like}`,
        `recipient_email.ilike.${like}`,
        `purchaser_name.ilike.${like}`,
        `recipient_name.ilike.${like}`,
      ].join(',')
    );
  }

  const { data, error, count } = await builder;
  if (error) {
    if (giftCertificateService.isMissingGiftCertificatesTable(error)) {
      const err = new Error(
        'gift_certificates table is missing. Apply migration 20261023053154_gift_certificates.'
      );
      err.statusCode = 503;
      throw err;
    }
    const err = new Error(error.message || 'Could not load gift certificates.');
    err.statusCode = 500;
    throw err;
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    certificates: rows.map(adminRowView),
    total: typeof count === 'number' ? count : rows.length,
    filters: { status: status || 'all', q: q || '', seasonYear, limit },
    settings: giftPlatformSettings(),
  };
}

async function getGiftCertificateForAdmin(supabase, idOrCode) {
  const key = String(idOrCode || '').trim();
  if (!key) {
    const err = new Error('Gift certificate id or code is required.');
    err.statusCode = 400;
    throw err;
  }

  let row = null;
  let error = null;
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);

  if (uuidLike) {
    const result = await supabase.from('gift_certificates').select('*').eq('id', key).maybeSingle();
    row = result.data;
    error = result.error;
  }

  if (!row && !error) {
    const result = await giftCertificateService.loadGiftCertificateByCode(supabase, key);
    if (result.tableMissing) {
      const err = new Error(
        'gift_certificates table is missing. Apply migration 20261023053154_gift_certificates.'
      );
      err.statusCode = 503;
      throw err;
    }
    row = result.row;
  }

  if (error) {
    if (giftCertificateService.isMissingGiftCertificatesTable(error)) {
      const err = new Error(
        'gift_certificates table is missing. Apply migration 20261023053154_gift_certificates.'
      );
      err.statusCode = 503;
      throw err;
    }
    throw error;
  }

  if (!row) {
    const err = new Error('Gift certificate not found.');
    err.statusCode = 404;
    throw err;
  }

  return { certificate: adminRowView(row) };
}

/**
 * Manual status change for ops.
 * - active → cancelled | refunded
 * - cancelled | refunded → active (reactivate unused ticket only when not redeemed)
 * Redeemed tickets cannot change status here (booking already exists).
 */
async function updateGiftCertificateStatus(supabase, { id, status, actorId } = {}) {
  const certificateId = String(id || '').trim();
  const nextStatus = String(status || '')
    .trim()
    .toLowerCase();

  if (!certificateId) {
    const err = new Error('Gift certificate id is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!ADMIN_MUTABLE_STATUSES.includes(nextStatus)) {
    const err = new Error(
      `Invalid status. Allowed: ${ADMIN_MUTABLE_STATUSES.join(', ')} (redeemed is set only via redeem).`
    );
    err.statusCode = 400;
    throw err;
  }

  const { data: existing, error: loadErr } = await supabase
    .from('gift_certificates')
    .select('*')
    .eq('id', certificateId)
    .maybeSingle();

  if (loadErr) {
    if (giftCertificateService.isMissingGiftCertificatesTable(loadErr)) {
      const err = new Error('gift_certificates table is missing.');
      err.statusCode = 503;
      throw err;
    }
    throw loadErr;
  }
  if (!existing) {
    const err = new Error('Gift certificate not found.');
    err.statusCode = 404;
    throw err;
  }

  const current = String(existing.status || '').toLowerCase();
  if (current === 'redeemed') {
    const err = new Error(
      'This ticket is already redeemed. Edit the booking instead of changing gift status.'
    );
    err.statusCode = 409;
    throw err;
  }
  if (current === nextStatus) {
    return { certificate: adminRowView(existing), unchanged: true };
  }

  if (nextStatus === 'active' && (current === 'cancelled' || current === 'refunded')) {
    // ok — reactivate
  } else if (current === 'active' && (nextStatus === 'cancelled' || nextStatus === 'refunded')) {
    // ok — void / mark refunded
  } else {
    const err = new Error(`Cannot change status from ${current} to ${nextStatus}.`);
    err.statusCode = 409;
    throw err;
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from('gift_certificates')
    .update({
      status: nextStatus,
      redeemed_booking_id: null,
      redeemed_at: null,
      updated_at: now,
    })
    .eq('id', certificateId)
    .neq('status', 'redeemed')
    .select('*')
    .maybeSingle();

  if (updErr) {
    const err = new Error(updErr.message || 'Could not update gift certificate.');
    err.statusCode = 500;
    throw err;
  }
  if (!updated) {
    const err = new Error('Gift certificate could not be updated (it may have been redeemed).');
    err.statusCode = 409;
    throw err;
  }

  try {
    const bookingReliability = require('./bookingReliability');
    await bookingReliability.insertActivity(supabase, {
      event_type: 'gift_certificate_status_changed',
      actor_type: 'admin',
      actor_id: actorId || null,
      message: `Gift ${updated.gift_code} status ${current} → ${nextStatus}`,
      payload: {
        gift_certificate_id: updated.id,
        gift_code: updated.gift_code,
        from_status: current,
        to_status: nextStatus,
      },
    });
  } catch (activityErr) {
    console.warn('[admin-gift] activity:', activityErr.message || activityErr);
  }

  return { certificate: adminRowView(updated), unchanged: false };
}

/**
 * Issue a Stripe refund for the gift purchase, then mark matching tickets refunded.
 * Idempotent if already refunded in Stripe / DB.
 */
async function refundGiftCertificate(supabase, stripe, { id, actorId } = {}) {
  const certificateId = String(id || '').trim();
  if (!certificateId) {
    const err = new Error('Gift certificate id is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!stripe) {
    const err = new Error('Stripe is not configured.');
    err.statusCode = 503;
    throw err;
  }

  const { data: existing, error: loadErr } = await supabase
    .from('gift_certificates')
    .select('*')
    .eq('id', certificateId)
    .maybeSingle();

  if (loadErr) {
    if (giftCertificateService.isMissingGiftCertificatesTable(loadErr)) {
      const err = new Error('gift_certificates table is missing.');
      err.statusCode = 503;
      throw err;
    }
    throw loadErr;
  }
  if (!existing) {
    const err = new Error('Gift certificate not found.');
    err.statusCode = 404;
    throw err;
  }

  const current = String(existing.status || '').toLowerCase();
  if (current === 'redeemed') {
    const err = new Error(
      'This ticket is already redeemed. Cancel/refund the booking separately; gift status stays redeemed.'
    );
    err.statusCode = 409;
    throw err;
  }

  const paymentIntentId = String(existing.stripe_payment_intent_id || '').trim();
  const sessionId = String(existing.stripe_checkout_session_id || '').trim();
  if (!paymentIntentId) {
    const err = new Error(
      'No Stripe payment intent on this ticket. Mark status refunded manually if payment was handled offline.'
    );
    err.statusCode = 400;
    throw err;
  }

  let refundId = null;
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `gift-refund:${paymentIntentId}` }
    );
    refundId = refund?.id || null;
  } catch (stripeErr) {
    const msg = String(stripeErr?.message || stripeErr || '');
    const already =
      /already been refunded|has already been refunded|charge_already_refunded/i.test(msg) ||
      stripeErr?.code === 'charge_already_refunded';
    if (!already) {
      const err = new Error(msg || 'Stripe refund failed.');
      err.statusCode = stripeErr?.statusCode || 502;
      throw err;
    }
  }

  const marked = await giftCertificateService.markGiftCertificatesRefunded(supabase, {
    paymentIntentId,
    checkoutSessionId: sessionId || null,
    source: 'admin_refund',
  });

  try {
    const bookingReliability = require('./bookingReliability');
    await bookingReliability.insertActivity(supabase, {
      checkout_session_id: sessionId || null,
      payment_intent_id: paymentIntentId,
      event_type: 'bio_gift_refunded',
      actor_type: 'admin',
      actor_id: actorId || null,
      message: `Admin refunded gift payment (${marked.updated} ticket(s) marked refunded).`,
      payload: {
        gift_certificate_id: certificateId,
        gift_code: existing.gift_code,
        refund_id: refundId,
        updated: marked.updated,
      },
    });
  } catch (activityErr) {
    console.warn('[admin-gift-refund] activity:', activityErr.message || activityErr);
  }

  const refreshed = await getGiftCertificateForAdmin(supabase, certificateId);
  return {
    ...refreshed,
    refundId,
    markedUpdated: marked.updated,
  };
}

module.exports = {
  ADMIN_STATUS_FILTERS,
  ADMIN_MUTABLE_STATUSES,
  isGiftSalesEnabled,
  isGiftStorefrontOpen,
  giftPlatformSettings,
  adminRowView,
  listGiftCertificatesForAdmin,
  getGiftCertificateForAdmin,
  updateGiftCertificateStatus,
  refundGiftCertificate,
};
