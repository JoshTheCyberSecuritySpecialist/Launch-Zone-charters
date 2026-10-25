/**
 * Redeem an active bioluminescence gift certificate into a dated charter booking.
 * Capacity is consumed only here — never at gift purchase.
 */

const { DateTime } = require('luxon');
const availabilityService = require('./availabilityService');
const bioPackagePricing = require('./bioluminescencePackagePricing');
const bookingReliability = require('./bookingReliability');
const giftCertificateService = require('./giftCertificateService');
const waiverContent = require('../content/waiverContent');
const {
  getBioluminescencePackage,
  isBioPrivatePackageId,
} = require('../config/bioluminescencePackages');
const { validateBioBookingSeason } = require('../config/bioluminescenceSeason');
const {
  charterEndIsoFromStart,
  resolveCharterDurationHours,
} = require('../lib/charterDuration');
const {
  normalizeGiftCode,
  publicGiftCertificateView,
  seasonForCertificate,
} = require('./giftCertificateRedeemHelpers');

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function httpError(message, statusCode = 400, code = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

async function lookupGiftCertificate(supabase, giftCode) {
  const code = normalizeGiftCode(giftCode);
  if (!code) throw httpError('Gift code is required.', 400, 'gift_code_required');

  const { row, tableMissing } = await giftCertificateService.loadGiftCertificateByCode(supabase, code);
  if (tableMissing) {
    throw httpError(
      'Gift certificates are not available yet. Please contact Launch Zone Charters.',
      503,
      'gift_table_missing'
    );
  }
  if (!row) {
    throw httpError('We could not find that gift code. Check the ticket and try again.', 404, 'gift_not_found');
  }
  return { certificate: row, view: publicGiftCertificateView(row) };
}

function parseCustomer(input = {}) {
  const fullName = String(input.full_name || input.fullName || '').trim();
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  const phone = String(input.phone || '').trim();
  if (!fullName || fullName.length < 2) {
    throw httpError('Please enter the guest full name.', 400);
  }
  if (!email || !email.includes('@')) {
    throw httpError('Please enter a valid email address.', 400);
  }
  if (!phone || phone.replace(/\D/g, '').length < 7) {
    throw httpError('Please enter a valid phone number.', 400);
  }
  return {
    full_name: fullName.slice(0, 120),
    email: email.slice(0, 200),
    phone: phone.slice(0, 40),
    sms_opt_in: Boolean(input.sms_opt_in || input.smsOptIn),
  };
}

function parseWaiver(input = {}) {
  const accepted = Boolean(input.accepted ?? input.agreed);
  const signature = String(input.signature || '').trim();
  if (!accepted || !signature) {
    throw httpError('Please accept the waiver and provide your signature.', 400);
  }
  return { accepted: true, signature: signature.slice(0, 200) };
}

/**
 * Redeem certificate → confirmed paid bio charter booking.
 */
async function redeemGiftCertificate(supabase, input = {}) {
  const code = normalizeGiftCode(input.giftCode || input.code);
  const { certificate, view } = await lookupGiftCertificate(supabase, code);

  if (view.status === 'redeemed') {
    throw httpError(
      'This gift ticket has already been redeemed.',
      409,
      'gift_already_redeemed'
    );
  }
  if (view.status === 'cancelled' || view.status === 'refunded') {
    throw httpError(
      'This gift ticket is no longer valid.',
      409,
      'gift_not_redeemable'
    );
  }
  if (!view.redeemable) {
    throw httpError('This gift ticket cannot be redeemed.', 409, 'gift_not_redeemable');
  }

  const startIso = String(input.startTime || input.start_time || '').trim();
  if (!startIso) throw httpError('Please choose a departure date and time.', 400);

  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) throw httpError('Invalid departure time.', 400);
  if (startMs < Date.now()) {
    throw httpError('That departure is in the past. Please choose another time.', 409);
  }

  const season = seasonForCertificate(certificate);
  const seasonCheck = validateBioBookingSeason({ startIso, season });
  if (!seasonCheck.ok) {
    throw httpError(seasonCheck.message || 'That date is outside the gift ticket season.', 400);
  }

  let pkg;
  try {
    pkg = getBioluminescencePackage(certificate.package_id);
  } catch (pkgErr) {
    throw httpError(pkgErr.message || 'Unknown gift package.', pkgErr.statusCode || 400);
  }

  const passengerCount = Math.max(1, Number(certificate.guest_count) || Number(pkg.guestCount) || 1);
  const durationHours = resolveCharterDurationHours(pkg);
  const endIso =
    charterEndIsoFromStart(startIso, durationHours) ||
    new Date(startMs + durationHours * 60 * 60 * 1000).toISOString();

  const customer = parseCustomer(input.customer || {});
  const waiver = parseWaiver(input.waiver || {});
  const termsAccepted = Boolean(input.termsAccepted ?? input.legal?.termsAccepted);
  if (!termsAccepted) {
    throw httpError('Please accept the terms and conditions.', 400);
  }
  const specialRequests = String(
    input.specialRequests || input.booking?.special_requests || ''
  )
    .trim()
    .slice(0, 1000);

  if (!availabilityService.isStartTimeAllowed(startIso)) {
    throw httpError(
      'This departure is too soon. Please choose a later time or call us for help.',
      409
    );
  }

  await availabilityService.assertUnifiedCharterSlotAvailable({
    startTime: startIso,
    endTime: endIso,
    charterType: 'bio',
    charterVariant: isBioPrivatePackageId(pkg.id) ? 'private' : 'shared',
    bioPackage: pkg,
    passengerCount,
    bookingSource: 'gift_redemption',
  });

  const charterInsertFields = await availabilityService.prepareCharterBookingInsertFields({
    charterType: 'bio',
    charterVariant: isBioPrivatePackageId(pkg.id) ? 'private' : 'shared',
    bioPackage: pkg,
    startTime: startIso,
    endTime: endIso,
    passengerCount,
  });

  if (!charterInsertFields?.boat_id) {
    throw httpError('No boat is available for that departure. Please choose another time.', 409);
  }

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .upsert(
      {
        full_name: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        sms_opt_in: customer.sms_opt_in,
      },
      { onConflict: 'email' }
    )
    .select('id, email')
    .single();
  if (customerError || !customerRow) {
    throw httpError(customerError?.message || 'Could not save guest details.', 500);
  }

  const paidDollars = roundMoney((Number(certificate.amount_paid_cents) || 0) / 100);
  const legalAcceptedAt = new Date().toISOString();
  const packageFields = bioPackagePricing.bioPackageBookingFields(pkg, {
    fifthPassengerAddon: false,
    passengerCount,
  });

  const bookingInsert = {
    customer_id: customerRow.id,
    boat_id: charterInsertFields.boat_id,
    booking_type: 'charter',
    charter_type: 'bio',
    charter_seating: charterInsertFields.charter_seating || pkg.seating || 'shared',
    guest_count: passengerCount,
    total_amount: paidDollars,
    start_time: startIso,
    end_time: endIso,
    duration_hours: durationHours,
    rental_type: null,
    captain_included: false,
    captain_fee: 0,
    base_price: paidDollars,
    peak_surcharge: 0,
    security_deposit: 0,
    total_price: paidDollars,
    deposit_amount: paidDollars,
    deposit_paid: paidDollars,
    balance_due: 0,
    amount_collected: paidDollars,
    payment_status: 'paid',
    // Requires migration 20261024001000_allow_gift_certificate_payment_method (do not apply without approval).
    payment_method: 'gift_certificate',
    booking_source: 'gift_redemption',
    status: 'confirmed',
    is_night_tour: true,
    is_rocket_tour: false,
    license_status: 'verified',
    insurance_status: 'verified',
    waiver_signed: true,
    waiver_signed_at: legalAcceptedAt,
    terms_accepted: true,
    // Captain-led gift tours are not self-drive rentals — rental damage-fee ack does not apply.
    damage_fee_acknowledged: false,
    checkout_session_id: certificate.stripe_checkout_session_id || null,
    stripe_payment_id: certificate.stripe_checkout_session_id || null,
    payment_intent_id: certificate.stripe_payment_intent_id || null,
    admin_notes: [
      'Booking source: Bioluminescence gift certificate redemption',
      `Gift code: ${view.giftCode}`,
      `Gift package: ${certificate.package_name || certificate.package_id}`,
      `Season: ${season.year}`,
      'Payment: prepaid gift certificate (no new charge at redemption)',
      certificate.purchaser_email ? `Purchaser email: ${certificate.purchaser_email}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    special_requests: specialRequests || null,
    original_total: paidDollars,
    discount_amount: 0,
    final_total: paidDollars,
    ...packageFields,
  };

  const { data: bookingRow, error: bookingError } = await supabase
    .from('bookings')
    .insert(bookingInsert)
    .select('id, start_time, status')
    .single();

  if (bookingError || !bookingRow) {
    const sharedMsg = String(bookingError?.message || '').match(
      /shared_charter_capacity_exceeded:(\d+)/i
    );
    throw httpError(
      sharedMsg
        ? `This charter only has ${sharedMsg[1]} passenger spot(s) remaining for the selected time.`
        : bookingError?.code === '23P01'
          ? 'That departure time is no longer available.'
          : bookingError?.message || 'Could not create booking.',
      sharedMsg || bookingError?.code === '23P01' ? 409 : 500
    );
  }

  const redeemedAt = new Date().toISOString();
  const claimed = await giftCertificateService.claimGiftCertificateRedemption(supabase, {
    giftCode: view.giftCode,
    bookingId: bookingRow.id,
    redeemedAt,
  });

  if (!claimed.ok) {
    await supabase.from('bookings').delete().eq('id', bookingRow.id);
    throw httpError(
      claimed.message || 'This gift ticket was just redeemed. Please use another ticket.',
      409,
      claimed.code || 'gift_claim_failed'
    );
  }

  const waiverFields = waiverContent.waiverInsertFields('charter');
  const { error: waiverErr } = await supabase.from('waivers').insert({
    booking_id: bookingRow.id,
    customer_id: customerRow.id,
    electronic_signature: waiver.signature,
    signature_date: legalAcceptedAt,
    ...waiverFields,
  });
  if (waiverErr) {
    console.warn('[gift-redeem] waiver insert:', waiverErr.message || waiverErr);
  }

  try {
    await bookingReliability.insertActivity(supabase, {
      booking_id: bookingRow.id,
      event_type: 'gift_certificate_redeemed',
      message: `Gift certificate ${view.giftCode} redeemed for bioluminescence charter.`,
      payload: {
        gift_code: view.giftCode,
        package_id: certificate.package_id,
        guest_count: passengerCount,
        start_time: startIso,
      },
    });
  } catch (activityErr) {
    console.warn('[gift-redeem] activity:', activityErr.message || activityErr);
  }

  const startLocal = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(
    process.env.BUSINESS_TIMEZONE || 'America/New_York'
  );

  return {
    ok: true,
    bookingId: bookingRow.id,
    giftCode: view.giftCode,
    status: bookingRow.status,
    startTime: bookingRow.start_time || startIso,
    startLabel: startLocal.isValid ? startLocal.toFormat("cccc, LLL d 'at' h:mm a") : startIso,
    packageName: certificate.package_name || pkg.name,
    guestCount: passengerCount,
    capacityConsumed: true,
  };
}

module.exports = {
  normalizeGiftCode,
  publicGiftCertificateView,
  seasonForCertificate,
  lookupGiftCertificate,
  redeemGiftCertificate,
};

// Re-export helpers for callers that already import this module.
