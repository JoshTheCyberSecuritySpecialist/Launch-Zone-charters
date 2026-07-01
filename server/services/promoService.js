/**
 * Server-authoritative promo validation.
 *
 * Generic percent/fixed discounts are loaded from public.promo_codes. The legacy
 * Groupon codes are also seeded there, with this fallback preserved for deployments
 * that have not run the migration yet.
 */
const GROUPON_PROMO_PRICES = {
  GROUPON: { half_day: 171.0, full_day: 315.0 },
  GROUPONFUN: { half_day: 153.9, full_day: 283.5 },
};

const WRONG_TRIP_MESSAGE = 'This code only works for Port Orange pontoon rentals';
const VALID_DISCOUNT_TYPES = new Set(['percent', 'fixed']);
const VALID_APPLIES_TO = new Set(['all', 'rentals', 'charters', 'groupon', 'private']);
const PROMO_ERROR_MESSAGES = {
  code_required: 'Enter a promo code.',
  invalid_subtotal: 'Invalid booking subtotal.',
  code_not_found: 'Promo code not found.',
  code_inactive: 'Promo code is inactive.',
  code_not_started: 'Promo code is not active yet.',
  code_expired: 'Promo code has expired.',
  max_uses_reached: 'Promo code max uses reached.',
  wrong_location: 'Groupon codes only work for Port Orange pontoon rentals.',
  wrong_boat: 'Groupon codes only work for pontoon rentals.',
  wrong_duration: 'Groupon codes only work for 4-hour or 8-hour rentals.',
  wrong_trip_type: 'Promo code does not apply to this booking type.',
  server_validation_failed: 'Server validation failed.',
};

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizePromoCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase();
}

function normalizeDiscountType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return VALID_DISCOUNT_TYPES.has(v) ? v : 'fixed';
}

function normalizeAppliesTo(raw) {
  const v = String(raw || 'all').trim().toLowerCase();
  if (v === 'rental') return 'rentals';
  if (v === 'charter') return 'charters';
  if (v === 'private_charter' || v === 'private-charter') return 'private';
  return VALID_APPLIES_TO.has(v) ? v : 'all';
}

function normalizeRentalLocation(raw) {
  const loc = String(raw || '')
    .trim()
    .toLowerCase();
  const compact = loc.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (
    compact === 'port orange' ||
    compact === 'daytona' ||
    compact === 'daytona beach'
  ) {
    return 'port-orange';
  }
  if (loc === 'titusville') return 'titusville';
  return compact || null;
}

function normalizeBoatName(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizeBookingType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'charters') return 'charter';
  if (v === 'rentals') return 'rental';
  return v;
}

function normalizeDurationHours(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function isPontoonBoat(input = {}) {
  const boatName = normalizeBoatName(input.boatName);
  const boatType = String(input.boatType || '').trim().toLowerCase();
  return (
    boatName.includes('suncatcher') ||
    boatName.includes('pontoon') ||
    boatType.includes('pontoon')
  );
}

function promoError(reasonCode, fallback) {
  return {
    ok: false,
    reasonCode,
    error: PROMO_ERROR_MESSAGES[reasonCode] || fallback || PROMO_ERROR_MESSAGES.server_validation_failed,
  };
}

/** Port Orange area pontoon rentals use ?location=daytona / Port Orange aliases. */
function isPortOrangePontoonRental({
  bookingMode,
  rentalLocation,
  boatType,
  boatName,
  rentalType,
  durationHours,
  captainIncluded,
}) {
  const duration = normalizeDurationHours(durationHours);
  return (
    bookingMode === 'rental' &&
    rentalLocation === 'port-orange' &&
    isPontoonBoat({ boatType, boatName }) &&
    (rentalType === 'half_day' || rentalType === 'full_day' || duration === 4 || duration === 8) &&
    !captainIncluded
  );
}

function buildEligibilityInput({ booking, boatRow }) {
  const bookingMode = String(booking.bookingMode || '')
    .trim()
    .toLowerCase();
  return {
    bookingMode: bookingMode === 'charter' ? 'charter' : 'rental',
    rentalLocation: normalizeRentalLocation(booking.rentalLocation),
    boatType: String(boatRow?.type || 'standard').trim().toLowerCase() === 'premium' ? 'premium' : 'standard',
    boatName: normalizeBoatName(booking.boatName || booking.boat_name || boatRow?.name),
    rentalType: String(booking.rental_type || '')
      .trim()
      .toLowerCase(),
    durationHours: normalizeDurationHours(booking.duration_hours),
    captainIncluded: Boolean(booking.captain_included),
    charterVariant: String(booking.charterVariant || booking.charter_variant || '')
      .trim()
      .toLowerCase(),
  };
}

function evaluateGrouponPromo(rawCode, originalTotal, eligibility) {
  const promoCode = normalizePromoCode(rawCode);
  if (!promoCode) return { status: 'none' };

  const priceTable = GROUPON_PROMO_PRICES[promoCode];
  if (!priceTable) return { status: 'unknown', promoCode };

  const location = normalizeRentalLocation(eligibility.rentalLocation);
  const duration = normalizeDurationHours(eligibility.durationHours);
  if (eligibility.bookingMode !== 'rental') {
    return { status: 'wrong_trip', promoCode, reasonCode: 'wrong_trip_type', message: PROMO_ERROR_MESSAGES.wrong_trip_type };
  }
  if (location !== 'port-orange') {
    return { status: 'wrong_trip', promoCode, reasonCode: 'wrong_location', message: PROMO_ERROR_MESSAGES.wrong_location };
  }
  if (!isPontoonBoat(eligibility)) {
    return { status: 'wrong_trip', promoCode, reasonCode: 'wrong_boat', message: PROMO_ERROR_MESSAGES.wrong_boat };
  }
  if (
    eligibility.rentalType !== 'half_day' &&
    eligibility.rentalType !== 'full_day' &&
    duration !== 4 &&
    duration !== 8
  ) {
    return { status: 'wrong_trip', promoCode, reasonCode: 'wrong_duration', message: PROMO_ERROR_MESSAGES.wrong_duration };
  }
  if (eligibility.captainIncluded) {
    return { status: 'wrong_trip', promoCode, reasonCode: 'wrong_trip_type', message: WRONG_TRIP_MESSAGE };
  }

  const rentalType = eligibility.rentalType || (duration === 8 ? 'full_day' : 'half_day');
  const finalTotal =
    rentalType === 'full_day' || duration === 8 ? priceTable.full_day : priceTable.half_day;
  const discountAmount = roundMoney(Math.max(0, originalTotal - finalTotal));

  return {
    status: 'applied',
    promoCode,
    originalTotal: roundMoney(originalTotal),
    finalTotal: roundMoney(finalTotal),
    discountAmount,
  };
}

function bookingCategory(input = {}) {
  const raw = String(input.bookingType || input.bookingMode || '').trim().toLowerCase();
  const charterVariant = String(input.charterVariant || '').trim().toLowerCase();
  if (raw === 'private' || charterVariant === 'private') return 'private';
  if (raw === 'groupon') return 'groupon';
  if (raw === 'charter' || raw === 'charters') return 'charters';
  if (raw === 'rental' || raw === 'rentals') return 'rentals';
  return raw || 'rentals';
}

function buildVirtualGrouponRow(code) {
  if (!GROUPON_PROMO_PRICES[code]) return null;
  return {
    id: null,
    code,
    description: code === 'GROUPONFUN' ? 'Legacy Groupon Fun direct-booking price match' : 'Legacy Groupon direct-booking price match',
    discount_type: 'fixed',
    discount_value: 0,
    max_uses: null,
    used_count: 0,
    active: true,
    applies_to: 'groupon',
    starts_at: null,
    expires_at: null,
  };
}

async function loadPromoCode(supabaseAdmin, code) {
  if (!supabaseAdmin) return { row: buildVirtualGrouponRow(code), error: null };
  const { data, error } = await supabaseAdmin
    .from('promo_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (error) {
    const missingTable =
      error.code === '42P01' || /relation .*promo_codes.* does not exist/i.test(String(error.message || ''));
    if (missingTable) {
      return { row: buildVirtualGrouponRow(code), error: null };
    }
    return { row: null, error };
  }
  return { row: data || buildVirtualGrouponRow(code), error: null };
}

function promoMatchesBooking(row, input, eligibility) {
  const appliesTo = normalizeAppliesTo(row?.applies_to);
  if (appliesTo === 'all') return true;
  if (appliesTo === 'groupon') {
    return Boolean(GROUPON_PROMO_PRICES[row.code]) && isPortOrangePontoonRental(eligibility);
  }
  const category = bookingCategory(input);
  if (appliesTo === 'private') {
    return category === 'private';
  }
  if (appliesTo === 'charters') {
    return category === 'charters' || category === 'private';
  }
  return appliesTo === category;
}

function calculateGenericDiscount(row, originalTotal) {
  const discountType = normalizeDiscountType(row.discount_type);
  const value = Number(row.discount_value);
  if (!Number.isFinite(value) || value <= 0) {
    return { error: 'Promo code is not configured correctly.' };
  }

  const original = roundMoney(originalTotal);
  const rawDiscount = discountType === 'percent' ? original * (Math.min(value, 100) / 100) : value;
  const discountAmount = roundMoney(Math.min(Math.max(0, rawDiscount), original));
  const finalTotal = roundMoney(Math.max(0, original - discountAmount));

  return {
    promoCode: row.code,
    originalTotal: original,
    discountAmount,
    finalTotal,
  };
}

async function validatePromoCode(supabaseAdmin, input = {}) {
  const promoCode = normalizePromoCode(input.code || input.promoCode || input.promo_code);
  if (!promoCode) {
    return promoError('code_required');
  }

  const discountableSubtotal = roundMoney(Number(input.subtotal ?? input.originalSubtotal ?? input.originalTotal ?? input.totalPrice ?? 0));
  const securityDeposit = roundMoney(Number(input.securityDeposit ?? input.security_deposit ?? 0));
  const originalTotal = roundMoney(discountableSubtotal + securityDeposit);
  if (!Number.isFinite(discountableSubtotal) || discountableSubtotal < 0 || !Number.isFinite(securityDeposit) || securityDeposit < 0) {
    return promoError('invalid_subtotal');
  }

  const { row, error } = await loadPromoCode(supabaseAdmin, promoCode);
  if (error) {
    console.warn('[promo-validate] promo lookup:', error.message);
    return promoError('server_validation_failed');
  }
  if (!row) {
    return promoError('code_not_found');
  }

  const now = input.now instanceof Date ? input.now : new Date();
  if (row.active !== true) {
    return promoError('code_inactive');
  }
  if (row.starts_at && new Date(String(row.starts_at)).getTime() > now.getTime()) {
    return promoError('code_not_started');
  }
  if (row.expires_at && new Date(String(row.expires_at)).getTime() < now.getTime()) {
    return promoError('code_expired');
  }
  const maxUses = row.max_uses == null ? null : Number(row.max_uses);
  const usedCount = Number(row.used_count || 0);
  if (maxUses != null && Number.isFinite(maxUses) && maxUses >= 0 && usedCount >= maxUses) {
    return promoError('max_uses_reached');
  }

  const category = bookingCategory(input);
  const eligibility = {
    bookingMode: category === 'charters' || category === 'private' ? 'charter' : 'rental',
    rentalLocation: normalizeRentalLocation(input.rentalLocation),
    boatName: normalizeBoatName(input.boatName),
    boatType: String(input.boatType || 'standard').trim().toLowerCase() === 'premium' ? 'premium' : 'standard',
    rentalType: String(input.rentalType || input.rental_type || '').trim().toLowerCase(),
    durationHours: normalizeDurationHours(input.durationHours || input.duration_hours),
    captainIncluded: Boolean(input.captainIncluded || input.captain_included),
    charterVariant: String(input.charterVariant || '').trim().toLowerCase(),
  };

  if (!promoMatchesBooking(row, input, eligibility)) {
    if (normalizeAppliesTo(row.applies_to) === 'groupon') {
      const grouponCheck = evaluateGrouponPromo(promoCode, discountableSubtotal, eligibility);
      return promoError(grouponCheck.reasonCode || 'wrong_trip_type');
    }
    return promoError('wrong_trip_type');
  }

  let result;
  if (GROUPON_PROMO_PRICES[promoCode] && normalizeAppliesTo(row.applies_to) === 'groupon') {
    result = evaluateGrouponPromo(promoCode, discountableSubtotal, eligibility);
    if (result.status === 'wrong_trip') {
      return promoError(result.reasonCode || 'wrong_trip_type', result.message);
    }
    if (result.status !== 'applied') {
      return promoError('code_not_found');
    }
  } else {
    const generic = calculateGenericDiscount(row, discountableSubtotal);
    if (generic.error) return promoError('server_validation_failed', generic.error);
    result = generic;
  }

  const finalSubtotal = roundMoney(result.finalTotal);
  const finalTotal = roundMoney(finalSubtotal + securityDeposit);
  return {
    ok: true,
    promoCode,
    originalSubtotal: roundMoney(discountableSubtotal),
    finalSubtotal,
    securityDeposit,
    originalTotal,
    discountAmount: result.discountAmount,
    finalTotal,
    description: row.description || null,
  };
}

/**
 * Apply validated promo to server-computed totals. Never trusts client discount fields.
 * @returns {{ expected: object, promo: object|null, error: string|null }}
 */
async function applyPromoToExpectedTotals(expected, { supabaseAdmin, booking, boatRow, bookingMode }) {
  const rawPromo = booking.promoCode != null ? booking.promoCode : booking.promo_code;
  const promoInput = String(rawPromo || '').trim();
  if (!promoInput) {
    return { expected, promo: null, error: null };
  }

  const eligibility = buildEligibilityInput({ booking, boatRow });
  const result = await validatePromoCode(supabaseAdmin, {
    code: promoInput,
    bookingType: bookingMode || eligibility.bookingMode,
    rentalLocation: booking.rentalLocation,
    boatName: eligibility.boatName,
    durationHours: eligibility.durationHours,
    subtotal:
      expected.mode === 'rental'
        ? roundMoney(expected.totalPrice - Number(booking.security_deposit || 0))
        : expected.totalPrice,
    securityDeposit: expected.mode === 'rental' ? Number(booking.security_deposit || 0) : 0,
    boatType: eligibility.boatType,
    rentalType: eligibility.rentalType,
    captainIncluded: eligibility.captainIncluded,
    charterVariant: eligibility.charterVariant,
  });

  if (!result.ok) {
    return { expected, promo: null, error: result.error || 'Invalid promo code' };
  }

  const mode = String(bookingMode || eligibility.bookingMode || 'rental').trim().toLowerCase();
  const amountDueToday =
    mode === 'charter' ? result.finalTotal : roundMoney(result.finalTotal * 0.5);

  return {
    expected: {
      ...expected,
      totalPrice: result.finalTotal,
      amountDueToday,
      promoCode: result.promoCode,
      originalTotal: result.originalTotal,
      discountAmount: result.discountAmount,
      finalTotal: result.finalTotal,
    },
    promo: {
      promo_code: result.promoCode,
      discount_amount: result.discountAmount,
      original_total: result.originalTotal,
      final_total: result.finalTotal,
    },
    error: null,
  };
}

async function incrementPromoUsage(supabaseAdmin, promoCode) {
  const code = normalizePromoCode(promoCode);
  if (!supabaseAdmin || !code) return;
  const { error } = await supabaseAdmin.rpc('increment_promo_code_usage', { p_code: code });
  if (!error) return;

  const { data: row, error: selectError } = await supabaseAdmin
    .from('promo_codes')
    .select('used_count')
    .eq('code', code)
    .maybeSingle();
  if (selectError || !row) {
    if (selectError && selectError.code !== '42P01') {
      console.warn('[promo-usage] lookup:', selectError.message);
    }
    return;
  }
  const nextUsedCount = Number(row.used_count || 0) + 1;
  const { error: updateError } = await supabaseAdmin
    .from('promo_codes')
    .update({ used_count: nextUsedCount, updated_at: new Date().toISOString() })
    .eq('code', code);
  if (updateError) {
    console.warn('[promo-usage] update:', updateError.message);
  }
}

module.exports = {
  GROUPON_PROMO_PRICES,
  WRONG_TRIP_MESSAGE,
  normalizePromoCode,
  normalizeAppliesTo,
  normalizeRentalLocation,
  isPortOrangePontoonRental,
  evaluateGrouponPromo,
  validatePromoCode,
  applyPromoToExpectedTotals,
  incrementPromoUsage,
};
