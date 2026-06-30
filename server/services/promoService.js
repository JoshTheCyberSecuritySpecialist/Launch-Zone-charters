/**
 * Server-authoritative Groupon promo validation.
 * Adjust GROUPON_PROMO_PRICES when deal terms change (keep in sync with src/lib/grouponPromo.ts).
 */

/** Standard Groupon deal — 4hr $171.00, 8hr $315.00 */
/** Groupon Fun deal — 4hr $153.90, 8hr $283.50 */
const GROUPON_PROMO_PRICES = {
  GROUPON: { half_day: 171.0, full_day: 315.0 },
  GROUPONFUN: { half_day: 153.9, full_day: 283.5 },
};

const WRONG_TRIP_MESSAGE = 'This code only works for Port Orange pontoon rentals';

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

function normalizeRentalLocation(raw) {
  const loc = String(raw || '')
    .trim()
    .toLowerCase();
  if (loc === 'daytona') return 'daytona';
  if (loc === 'titusville') return 'titusville';
  return null;
}

/** Port Orange area pontoon rentals use ?location=daytona and standard (non-premium) boats. */
function isPortOrangePontoonRental({
  bookingMode,
  rentalLocation,
  boatType,
  rentalType,
  captainIncluded,
}) {
  return (
    bookingMode === 'rental' &&
    rentalLocation === 'daytona' &&
    boatType === 'standard' &&
    (rentalType === 'half_day' || rentalType === 'full_day') &&
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
    rentalType: String(booking.rental_type || '')
      .trim()
      .toLowerCase(),
    captainIncluded: Boolean(booking.captain_included),
  };
}

function evaluateGrouponPromo(rawCode, originalTotal, eligibility) {
  const promoCode = normalizePromoCode(rawCode);
  if (!promoCode) return { status: 'none' };

  const priceTable = GROUPON_PROMO_PRICES[promoCode];
  if (!priceTable) return { status: 'unknown', promoCode };

  if (!isPortOrangePontoonRental(eligibility)) {
    return { status: 'wrong_trip', promoCode, message: WRONG_TRIP_MESSAGE };
  }

  const rentalType = eligibility.rentalType;
  const finalTotal =
    rentalType === 'half_day' ? priceTable.half_day : priceTable.full_day;
  const discountAmount = roundMoney(Math.max(0, originalTotal - finalTotal));

  return {
    status: 'applied',
    promoCode,
    originalTotal: roundMoney(originalTotal),
    finalTotal: roundMoney(finalTotal),
    discountAmount,
  };
}

/**
 * Apply validated promo to server-computed totals. Never trusts client discount fields.
 * @returns {{ expected: object, promo: object|null, error: string|null }}
 */
function applyPromoToExpectedTotals(expected, { booking, boatRow, bookingMode }) {
  const rawPromo = booking.promoCode != null ? booking.promoCode : booking.promo_code;
  const promoInput = String(rawPromo || '').trim();
  if (!promoInput) {
    return { expected, promo: null, error: null };
  }

  const eligibility = buildEligibilityInput({ booking, boatRow });
  const result = evaluateGrouponPromo(promoInput, expected.totalPrice, eligibility);

  if (result.status === 'unknown') {
    return { expected, promo: null, error: 'Invalid promo code' };
  }
  if (result.status === 'wrong_trip') {
    return { expected, promo: null, error: result.message || WRONG_TRIP_MESSAGE };
  }
  if (result.status !== 'applied') {
    return { expected, promo: null, error: null };
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

module.exports = {
  GROUPON_PROMO_PRICES,
  WRONG_TRIP_MESSAGE,
  normalizePromoCode,
  normalizeRentalLocation,
  isPortOrangePontoonRental,
  evaluateGrouponPromo,
  applyPromoToExpectedTotals,
};
