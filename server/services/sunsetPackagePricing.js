const { validateCharterPassengerCount } = require('../charterCapacity');
const {
  getSunsetPackage,
  isDirectSunsetPackagePricingEnabled,
  isSunsetPackageId,
  sunsetPackageSavingsCents,
} = require('../config/sunsetPackages');
const { extractPricingPackageId } = require('./bioluminescencePackagePricing');

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeSunsetCharterType(charterType) {
  const t = String(charterType || '').trim().toLowerCase();
  if (t === 'sunset' || t === 'sunset_cruise') return 'sunset';
  return t;
}

function validateDirectSunsetPackageCheckout({
  charterType,
  pricingPackageId,
  passengerCountFromClient,
  bookingSource,
}) {
  if (!isDirectSunsetPackagePricingEnabled()) {
    return { ok: true, useLegacy: true };
  }
  if (normalizeSunsetCharterType(charterType) !== 'sunset') {
    return { ok: true, useLegacy: false };
  }
  const source = String(bookingSource || '').trim().toLowerCase();
  if (source === 'groupon') {
    return { ok: true, skipPackage: true };
  }

  const packageId = String(pricingPackageId || '').trim();
  if (!packageId) {
    return {
      ok: false,
      error: 'Select a Sunset & Wildlife package to continue.',
    };
  }

  let pkg;
  try {
    pkg = getSunsetPackage(packageId);
  } catch (e) {
    return { ok: false, error: e.message || 'Invalid sunset package.' };
  }

  const clientCountRaw = Number(passengerCountFromClient);
  if (!Number.isFinite(clientCountRaw)) {
    return { ok: false, error: 'Passenger count is required for sunset bookings.' };
  }
  const clientCount = Math.max(1, Math.round(clientCountRaw));

  if (pkg.seating === 'private') {
    const validation = validateCharterPassengerCount(clientCount);
    if (!validation.valid) {
      return { ok: false, error: validation.error };
    }
    if (validation.count > pkg.maxGuests) {
      return {
        ok: false,
        error: `This package allows up to ${pkg.maxGuests} guests.`,
      };
    }
    return {
      ok: true,
      package: pkg,
      passengerCount: validation.count,
      charterVariant: 'private',
    };
  }

  if (clientCount !== pkg.guestCount) {
    return {
      ok: false,
      error: `Guest count must match the selected package (${pkg.guestCount} guests).`,
    };
  }

  return {
    ok: true,
    package: pkg,
    passengerCount: pkg.guestCount,
    charterVariant: 'shared',
  };
}

function sunsetPackageExpectedTotals(pkg, passengerCount) {
  const totalPrice = roundMoney(pkg.priceCents / 100);
  const guests =
    pkg.seating === 'private'
      ? Math.max(1, Math.min(pkg.maxGuests, Math.round(Number(passengerCount) || 1)))
      : pkg.guestCount;
  const ticketPrice = pkg.seating === 'private' ? totalPrice : roundMoney(totalPrice / guests);
  return {
    mode: 'charter',
    basePrice: totalPrice,
    ticketPrice,
    guestCount: guests,
    durationHours: 1,
    totalPrice,
    amountDueToday: totalPrice,
    sunsetPackage: pkg,
    charterVariant: pkg.seating === 'private' ? 'private' : 'shared',
  };
}

function resolveCharterSunsetPricing({
  charterType,
  pricingPackageId,
  passengerCount,
  bookingSource,
}) {
  const validated = validateDirectSunsetPackageCheckout({
    charterType,
    pricingPackageId,
    passengerCountFromClient: passengerCount,
    bookingSource,
  });
  if (!validated.ok) {
    return { kind: 'error', error: validated.error };
  }
  if (validated.useLegacy || validated.skipPackage) {
    return { kind: 'legacy' };
  }
  if (!validated.package) {
    return { kind: 'legacy' };
  }
  return {
    kind: 'package',
    package: validated.package,
    passengerCount: validated.passengerCount,
    charterVariant: validated.charterVariant,
    totals: sunsetPackageExpectedTotals(validated.package, validated.passengerCount),
  };
}

function sunsetPackageBookingFields(pkg, passengerCount) {
  const guests =
    pkg.seating === 'private'
      ? Math.max(1, Math.min(pkg.maxGuests, Math.round(Number(passengerCount) || 1)))
      : pkg.guestCount;
  return {
    pricing_package_id: pkg.id,
    pricing_package_name: pkg.name,
    package_guest_count: guests,
    standard_value_cents: pkg.standardValueCents,
    package_price_cents: pkg.priceCents,
    discount_amount_cents: sunsetPackageSavingsCents(pkg),
    final_amount_cents: pkg.priceCents,
  };
}

function stripeLineItemNameForSunsetPackage(pkg) {
  if (pkg.id === 'sunset_solo') return 'Sunset Solo Seat — 1 Guest';
  if (pkg.id === 'sunset_two') return 'Sunset for Two — 2 Guests';
  if (pkg.id === 'sunset_three') return 'Sunset for Three — 3 Guests';
  if (pkg.id === 'sunset_family') return 'Sunset Family Charter — Up to 5 Guests';
  return 'Private Sunset Charter — Up to 5 Guests';
}

function assertSunsetPackageRequestAllowed({ pricingPackageId, charterType, bookingMode }) {
  const packageId = String(pricingPackageId || '').trim();
  if (!packageId || !isSunsetPackageId(packageId)) {
    return { ok: true };
  }
  if (String(bookingMode || '').trim().toLowerCase() !== 'charter') {
    return {
      ok: false,
      statusCode: 400,
      code: 'sunset_package_invalid_context',
      error: 'Sunset package pricing applies only to charter bookings.',
    };
  }
  if (normalizeSunsetCharterType(charterType) !== 'sunset') {
    return {
      ok: false,
      statusCode: 400,
      code: 'sunset_package_invalid_context',
      error: 'Sunset package pricing applies only to Sunset & Wildlife cruises.',
    };
  }
  if (!isDirectSunsetPackagePricingEnabled()) {
    return {
      ok: false,
      statusCode: 503,
      code: 'sunset_package_pricing_unavailable',
      error:
        'Direct sunset package booking is temporarily unavailable. Please call 803-542-1761 or refresh the page to continue.',
    };
  }
  return { ok: true };
}

function resolveStaffSunsetCharterPackage({ body, passengerCount }) {
  const pricingPackageId = extractPricingPackageId(body);
  if (pricingPackageId && !isSunsetPackageId(pricingPackageId)) {
    return {
      ok: true,
      passengerCount,
      charterType: String(body?.charter_type || body?.charterType || 'captain_charter')
        .trim()
        .toLowerCase(),
      package: null,
    };
  }
  if (pricingPackageId && !isDirectSunsetPackagePricingEnabled()) {
    return {
      ok: false,
      statusCode: 503,
      code: 'sunset_package_pricing_unavailable',
      error:
        'Direct sunset package booking is temporarily unavailable on the server. Disable package selection or enable server package pricing.',
    };
  }
  const charterTypeRaw = String(body?.charter_type || body?.charterType || '')
    .trim()
    .toLowerCase();
  const isSunset =
    Boolean(pricingPackageId && isSunsetPackageId(pricingPackageId)) ||
    charterTypeRaw === 'sunset' ||
    charterTypeRaw === 'sunset_cruise';
  if (!isSunset) {
    return {
      ok: true,
      passengerCount,
      charterType: charterTypeRaw || 'captain_charter',
      package: null,
    };
  }
  const sunsetCheck = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId,
    passengerCountFromClient: passengerCount,
    bookingSource: String(body?.booking_source || body?.bookingSource || 'admin').toLowerCase(),
  });
  if (!sunsetCheck.ok) {
    return { ok: false, error: sunsetCheck.error, statusCode: sunsetCheck.statusCode || 400 };
  }
  return {
    ok: true,
    passengerCount: sunsetCheck.passengerCount,
    charterType: 'sunset',
    package: sunsetCheck.package,
    charterVariant: sunsetCheck.charterVariant,
  };
}

module.exports = {
  normalizeSunsetCharterType,
  validateDirectSunsetPackageCheckout,
  sunsetPackageExpectedTotals,
  resolveCharterSunsetPricing,
  sunsetPackageBookingFields,
  stripeLineItemNameForSunsetPackage,
  resolveStaffSunsetCharterPackage,
  assertSunsetPackageRequestAllowed,
  isDirectSunsetPackagePricingEnabled,
  isSunsetPackageId,
};
