/**
 * Shared server-side Groupon voucher eligibility decisions.
 */
const {
  extractLastName,
  normalizeOwnerNameForMatch,
  maskVoucherLastFour,
} = require('./grouponVoucherUtils');

const CUSTOMER_MESSAGES = {
  not_found: 'We could not verify that voucher. Check the voucher number and last name.',
  not_available: 'This voucher is no longer available for online booking.',
  already_booked: 'This voucher is already connected to a reservation.',
  unmapped: 'This Groupon option is not available for online booking yet.',
  reserved: 'This voucher is currently reserved by another session. Try again shortly.',
  wrong_service: 'This voucher does not cover the selected service.',
  guest_mismatch: 'This voucher covers a different guest count. Contact us for help.',
  name_mismatch: 'We could not verify that voucher. Check the voucher number and last name.',
};

function isRefunded(voucher) {
  const status = String(voucher.source_status || '').trim().toLowerCase();
  return Boolean(voucher.refunded_at) || status === 'refunded';
}

function isRedeemed(voucher) {
  return String(voucher.redeemed_flag || '').trim().toLowerCase() === 'yes';
}

function isExpired(voucher, nowMs = Date.now()) {
  const exp = voucher.expires_at ? new Date(String(voucher.expires_at)).getTime() : NaN;
  return Number.isFinite(exp) && exp < nowMs;
}

function isReservedByOther(voucher, sessionToken) {
  if (!voucher.reserved_session_token) return false;
  if (String(voucher.local_status) !== 'reserved') return false;
  const reservedUntil = voucher.reserved_until ? new Date(String(voucher.reserved_until)).getTime() : NaN;
  if (Number.isFinite(reservedUntil) && reservedUntil < Date.now()) return false;
  return String(voucher.reserved_session_token) !== String(sessionToken || '');
}

function mappingMatchesRequest(mapping, request = {}) {
  if (!mapping) return false;
  const bookingType = String(request.bookingType || mapping.booking_type || '').toLowerCase();
  if (bookingType && String(mapping.booking_type) !== bookingType) return false;
  if (mapping.booking_type === 'charter') {
    const charterType = String(request.charterType || mapping.charter_type || '').toLowerCase();
    if (charterType && String(mapping.charter_type || '') !== charterType) return false;
  }
  if (mapping.booking_type === 'rental') {
    const rentalType = String(request.rentalType || mapping.rental_type || '').toLowerCase();
    if (rentalType && String(mapping.rental_type || '') !== rentalType) return false;
  }
  return true;
}

function evaluateGrouponVoucherEligibility(voucher, mapping, options = {}) {
  const {
    lastName = null,
    sessionToken = null,
    requestedGuestCount = null,
    request = {},
    allowReservedSession = null,
  } = options;

  if (!voucher) {
    return {
      eligible: false,
      reasonCode: 'not_found',
      customerMessage: CUSTOMER_MESSAGES.not_found,
      adminDetail: 'Voucher not found.',
    };
  }

  if (lastName != null) {
    const provided = String(lastName || '').trim().toLowerCase();
    const stored = extractLastName(voucher.owner_name);
    const normalizedStored = normalizeOwnerNameForMatch(voucher.owner_name).split(' ').pop() || stored;
    if (!provided || (stored !== provided && normalizedStored !== provided)) {
      return {
        eligible: false,
        reasonCode: 'name_mismatch',
        customerMessage: CUSTOMER_MESSAGES.name_mismatch,
        adminDetail: 'Last name mismatch during verification.',
      };
    }
  }

  if (isRefunded(voucher)) {
    return {
      eligible: false,
      reasonCode: 'refunded',
      customerMessage: CUSTOMER_MESSAGES.not_available,
      adminDetail: 'Imported Groupon status is refunded.',
    };
  }

  if (isExpired(voucher)) {
    return {
      eligible: false,
      reasonCode: 'expired',
      customerMessage: CUSTOMER_MESSAGES.not_available,
      adminDetail: 'Voucher expiration date has passed.',
    };
  }

  if (!mapping || !mapping.active) {
    return {
      eligible: false,
      reasonCode: 'unmapped',
      customerMessage: CUSTOMER_MESSAGES.unmapped,
      adminDetail: 'Deal option is not mapped to an internal service.',
    };
  }

  if (isRedeemed(voucher)) {
    const linkedSame =
      voucher.booking_id &&
      allowReservedSession &&
      String(voucher.local_status) === 'booked';
    if (!linkedSame) {
      return {
        eligible: false,
        reasonCode: 'redeemed',
        customerMessage: CUSTOMER_MESSAGES.not_available,
        adminDetail: 'Groupon report marks voucher redeemed without valid local booking link.',
      };
    }
  }

  if (['cancelled', 'used', 'review_required'].includes(String(voucher.local_status || ''))) {
    return {
      eligible: false,
      reasonCode: 'local_status_blocked',
      customerMessage: CUSTOMER_MESSAGES.not_available,
      adminDetail: `Local voucher status is ${voucher.local_status}.`,
    };
  }

  if (voucher.booking_id) {
    const linkedSame =
      options.allowLinkedBookingId && String(voucher.booking_id) === String(options.allowLinkedBookingId);
    if (!linkedSame) {
      return {
        eligible: false,
        reasonCode: 'already_booked',
        customerMessage: CUSTOMER_MESSAGES.already_booked,
        adminDetail: 'Voucher already linked to a booking request or reservation.',
      };
    }
  }

  const activeSession = allowReservedSession || sessionToken;
  if (isReservedByOther(voucher, activeSession)) {
    return {
      eligible: false,
      reasonCode: 'reserved',
      customerMessage: CUSTOMER_MESSAGES.reserved,
      adminDetail: 'Voucher reserved by another active session.',
    };
  }

  if (request && Object.keys(request).length && !mappingMatchesRequest(mapping, request)) {
    return {
      eligible: false,
      reasonCode: 'wrong_service',
      customerMessage: CUSTOMER_MESSAGES.wrong_service,
      adminDetail: 'Requested service does not match voucher mapping.',
    };
  }

  const coveredGuestCount = Math.max(1, Number(mapping.covered_guest_count || 1));
  if (requestedGuestCount != null && Number(requestedGuestCount) !== coveredGuestCount) {
    return {
      eligible: false,
      reasonCode: 'guest_mismatch',
      customerMessage: CUSTOMER_MESSAGES.guest_mismatch,
      adminDetail: `Voucher covers ${coveredGuestCount} guests; requested ${requestedGuestCount}.`,
      coveredGuestCount,
    };
  }

  return {
    eligible: true,
    reasonCode: 'eligible',
    customerMessage: null,
    adminDetail: 'Voucher eligible for online booking.',
    mappedService: mapping,
    coveredGuestCount,
    expirationTimestamp: voucher.expires_at || null,
    importedGrouponStatus: voucher.source_status || null,
    localVoucherStatus: voucher.local_status || null,
    voucherMasked: maskVoucherLastFour(voucher.voucher_last_four),
    dealName: voucher.deal_name || null,
    optionName: voucher.option_name || null,
  };
}

module.exports = {
  CUSTOMER_MESSAGES,
  evaluateGrouponVoucherEligibility,
  isRefunded,
  isRedeemed,
  isExpired,
  mappingMatchesRequest,
};
