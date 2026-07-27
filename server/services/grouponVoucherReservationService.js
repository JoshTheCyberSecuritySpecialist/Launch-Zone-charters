/**
 * Groupon voucher reservation lifecycle with conditional updates.
 */
const crypto = require('crypto');
const { evaluateGrouponVoucherEligibility } = require('./grouponVoucherEligibilityService');
const { hashVoucherNumber, normalizeVoucherNumber } = require('./grouponVoucherUtils');
const { issueReservationSession, DEFAULT_TTL_MS } = require('./grouponSessionToken');
const { recordVoucherEvent } = require('./grouponImportService');
const availabilityService = require('./availabilityService');

const RESERVATION_TTL_MS = Number(process.env.GROUPON_RESERVATION_TTL_MS || DEFAULT_TTL_MS);

async function rentalBoatIdForMapping(mapping) {
  if (!mapping || mapping.booking_type !== 'rental') return null;
  return availabilityService.resolveRentalBoatForLocation(mapping.rental_location || 'port-orange');
}

async function releaseExpiredReservations(supabase) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('groupon_vouchers')
    .update({
      local_status: 'available',
      reserved_session_token: null,
      reserved_until: null,
    })
    .eq('local_status', 'reserved')
    .lt('reserved_until', nowIso)
    .is('booking_id', null)
    .select('id');
  if (error) throw new Error(error.message || 'Could not release expired voucher reservations.');
  return (data || []).length;
}

async function loadVoucherWithMapping(supabase, voucherId) {
  const { data, error } = await supabase
    .from('groupon_vouchers')
    .select('*, groupon_deal_option_mappings(*)')
    .eq('id', voucherId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not load voucher.');
  if (!data) return null;
  const mapping = Array.isArray(data.groupon_deal_option_mappings)
    ? data.groupon_deal_option_mappings[0]
    : data.groupon_deal_option_mappings;
  return { voucher: data, mapping: mapping || null };
}

async function findVoucherByHashWithMapping(supabase, voucherHash) {
  const { data, error } = await supabase
    .from('groupon_vouchers')
    .select('*, groupon_deal_option_mappings(*)')
    .eq('voucher_hash', voucherHash)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not load voucher.');
  if (!data) return null;
  const mapping = Array.isArray(data.groupon_deal_option_mappings)
    ? data.groupon_deal_option_mappings[0]
    : data.groupon_deal_option_mappings;
  return { voucher: data, mapping: mapping || null };
}

async function reserveVoucherAtomically(supabase, { voucherId, sessionToken, reservedUntilIso }) {
  const nowIso = new Date().toISOString();
  const updatePayload = {
    local_status: 'reserved',
    reserved_session_token: sessionToken,
    reserved_until: reservedUntilIso,
  };

  const { data: fromAvailable, error: availableError } = await supabase
    .from('groupon_vouchers')
    .update(updatePayload)
    .eq('id', voucherId)
    .eq('local_status', 'available')
    .is('booking_id', null)
    .select('id, voucher_last_four, local_status, reserved_until')
    .maybeSingle();
  if (availableError) throw new Error(availableError.message || 'Could not reserve voucher.');
  if (fromAvailable) return fromAvailable;

  const { data: fromExpiredHold, error: expiredError } = await supabase
    .from('groupon_vouchers')
    .update(updatePayload)
    .eq('id', voucherId)
    .eq('local_status', 'reserved')
    .is('booking_id', null)
    .lt('reserved_until', nowIso)
    .select('id, voucher_last_four, local_status, reserved_until')
    .maybeSingle();
  if (expiredError) throw new Error(expiredError.message || 'Could not reserve voucher.');
  return fromExpiredHold || null;
}

async function verifyAndReserveVoucher(supabase, { voucherNumber, lastName, requestIp = null }) {
  await releaseExpiredReservations(supabase);

  const normalized = normalizeVoucherNumber(voucherNumber);
  const voucherHash = hashVoucherNumber(normalized);
  const loaded = await findVoucherByHashWithMapping(supabase, voucherHash);

  const eligibility = evaluateGrouponVoucherEligibility(loaded?.voucher || null, loaded?.mapping || null, {
    lastName: String(lastName || '').trim(),
  });
  if (!eligibility.eligible) {
    return { ok: false, ...eligibility };
  }

  const sessionToken = crypto.randomBytes(24).toString('hex');
  const reservedUntilIso = new Date(Date.now() + RESERVATION_TTL_MS).toISOString();
  const reserved = await reserveVoucherAtomically(supabase, {
    voucherId: loaded.voucher.id,
    sessionToken,
    reservedUntilIso,
  });

  if (!reserved) {
    const refreshed = await findVoucherByHashWithMapping(supabase, voucherHash);
    const retryEligibility = evaluateGrouponVoucherEligibility(
      refreshed?.voucher || null,
      refreshed?.mapping || null,
      { lastName: String(lastName || '').trim() }
    );
    return { ok: false, ...retryEligibility, reasonCode: retryEligibility.reasonCode || 'reserved' };
  }

  const issued = issueReservationSession({
    voucherId: loaded.voucher.id,
    sessionToken,
    ttlMs: RESERVATION_TTL_MS,
  });

  await recordVoucherEvent(supabase, {
    voucherId: loaded.voucher.id,
    eventType: 'reserved',
    actorType: 'system',
    message: 'Voucher reserved for online booking session.',
    payload: { requestIp, reservationExpiresAt: issued.reservationExpiresAt },
  });

  const mapping = loaded.mapping;
  const rentalBoatId = await rentalBoatIdForMapping(mapping);
  return {
    ok: true,
    clientToken: issued.clientToken,
    reservationExpiresAt: issued.reservationExpiresAt,
    voucherMasked: eligibility.voucherMasked,
    serviceLabel: mapping?.service_label || null,
    coveredGuestCount: eligibility.coveredGuestCount,
    bookingType: mapping?.booking_type || null,
    charterType: mapping?.charter_type || null,
    rentalType: mapping?.rental_type || null,
    rentalLocation: mapping?.rental_location || null,
    rentalBoatId,
    dealName: loaded.voucher.deal_name || null,
    optionName: loaded.voucher.option_name || null,
    expiresAt: loaded.voucher.expires_at || null,
  };
}

async function loadReservedVoucherByClientToken(supabase, clientToken) {
  const { verifyReservationClientToken } = require('./grouponSessionToken');
  const verified = verifyReservationClientToken(clientToken);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  await releaseExpiredReservations(supabase);
  const loaded = await loadVoucherWithMapping(supabase, verified.voucherId);
  if (!loaded?.voucher) return { ok: false, reason: 'not_found' };

  const eligibility = evaluateGrouponVoucherEligibility(loaded.voucher, loaded.mapping, {
    sessionToken: verified.sessionToken,
    allowReservedSession: verified.sessionToken,
  });
  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reasonCode, customerMessage: eligibility.customerMessage };
  }

  if (String(loaded.voucher.reserved_session_token || '') !== verified.sessionToken) {
    return { ok: false, reason: 'invalid_token', customerMessage: 'This booking session expired. Verify your voucher again.' };
  }

  return {
    ok: true,
    voucher: loaded.voucher,
    mapping: loaded.mapping,
    sessionToken: verified.sessionToken,
    eligibility,
    expiresAt: verified.expiresAt,
    rentalBoatId: await rentalBoatIdForMapping(loaded.mapping),
  };
}

async function releaseVoucherReservation(supabase, { voucherId, sessionToken, actorType = 'system', actorId = null, reason = 'Reservation released.' }) {
  const { data, error } = await supabase
    .from('groupon_vouchers')
    .update({
      local_status: 'available',
      reserved_session_token: null,
      reserved_until: null,
    })
    .eq('id', voucherId)
    .eq('local_status', 'reserved')
    .eq('reserved_session_token', sessionToken)
    .is('booking_id', null)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not release voucher reservation.');
  if (data?.id) {
    await recordVoucherEvent(supabase, {
      voucherId: data.id,
      eventType: 'reservation_released',
      actorType,
      actorId,
      message: reason,
    });
  }
  return Boolean(data?.id);
}

async function markVoucherBooked(supabase, { voucherId, sessionToken, bookingId, actorType = 'system', actorId = null }) {
  const { data, error } = await supabase
    .from('groupon_vouchers')
    .update({
      local_status: 'booked',
      booking_id: bookingId,
      reserved_session_token: null,
      reserved_until: null,
    })
    .eq('id', voucherId)
    .eq('reserved_session_token', sessionToken)
    .in('local_status', ['reserved', 'available'])
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not mark voucher booked.');
  if (!data?.id) return false;
  await recordVoucherEvent(supabase, {
    voucherId: data.id,
    eventType: 'booked',
    actorType,
    actorId,
    message: 'Voucher linked to confirmed booking.',
    payload: { bookingId },
  });
  return true;
}

module.exports = {
  RESERVATION_TTL_MS,
  releaseExpiredReservations,
  verifyAndReserveVoucher,
  loadReservedVoucherByClientToken,
  releaseVoucherReservation,
  markVoucherBooked,
  findVoucherByHashWithMapping,
};
