const { validateCharterPassengerCount } = require('../charterCapacity');
const {
  getRocketLaunchPackage,
  isDirectRocketPackagePricingEnabled,
  isRocketLaunchPackageId,
} = require('../config/rocketLaunchPackages');
const { extractPricingPackageId } = require('./bioluminescencePackagePricing');

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeRocketCharterType(charterType) {
  const t = String(charterType || '').trim().toLowerCase();
  if (t === 'rocket' || t === 'rocket_launch') return 'rocket';
  return t;
}

function validateDirectRocketPackageCheckout({
  charterType,
  pricingPackageId,
  passengerCountFromClient,
  bookingSource,
}) {
  if (!isDirectRocketPackagePricingEnabled()) {
    return { ok: true, useLegacy: true };
  }
  if (normalizeRocketCharterType(charterType) !== 'rocket') {
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
      error: 'Select a rocket launch package (solo seat, duo, or private charter) to continue.',
    };
  }

  let pkg;
  try {
    pkg = getRocketLaunchPackage(packageId);
  } catch (e) {
    return { ok: false, error: e.message || 'Invalid rocket launch package.' };
  }

  const clientCountRaw = Number(passengerCountFromClient);
  if (!Number.isFinite(clientCountRaw)) {
    return { ok: false, error: 'Passenger count is required for rocket launch bookings.' };
  }
  const clientCount = Math.max(1, Math.round(clientCountRaw));

  if (pkg.id === 'rocket_private') {
    const validation = validateCharterPassengerCount(clientCount);
    if (!validation.valid) {
      return { ok: false, error: validation.error };
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

function rocketPackageExpectedTotals(pkg, passengerCount) {
  const totalPrice = roundMoney(pkg.priceCents / 100);
  const guests =
    pkg.id === 'rocket_private'
      ? Math.max(1, Math.min(5, Math.round(Number(passengerCount) || 1)))
      : pkg.guestCount;
  const ticketPrice = pkg.id === 'rocket_private' ? totalPrice : roundMoney(totalPrice / guests);
  return {
    mode: 'charter',
    basePrice: totalPrice,
    ticketPrice,
    guestCount: guests,
    durationHours: 1,
    totalPrice,
    amountDueToday: totalPrice,
    rocketPackage: pkg,
    charterVariant: pkg.seating === 'private' ? 'private' : 'shared',
  };
}

function resolveCharterRocketPricing({
  charterType,
  pricingPackageId,
  passengerCount,
  bookingSource,
}) {
  const validated = validateDirectRocketPackageCheckout({
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
    totals: rocketPackageExpectedTotals(validated.package, validated.passengerCount),
  };
}

function rocketPackageBookingFields(pkg, passengerCount) {
  const guests =
    pkg.id === 'rocket_private'
      ? Math.max(1, Math.min(5, Math.round(Number(passengerCount) || 1)))
      : pkg.guestCount;
  return {
    pricing_package_id: pkg.id,
    pricing_package_name: pkg.name,
    package_guest_count: guests,
    standard_value_cents: pkg.priceCents,
    package_price_cents: pkg.priceCents,
    discount_amount_cents: 0,
    final_amount_cents: pkg.priceCents,
  };
}

function stripeLineItemNameForRocketPackage(pkg) {
  if (pkg.id === 'rocket_solo') {
    return 'Solo Rocket Launch Seat — 1 Guest';
  }
  if (pkg.id === 'rocket_duo') {
    return 'Rocket Launch Duo — 2 Guests';
  }
  if (pkg.id === 'rocket_three') {
    return 'Rocket Launch for Three — 3 Guests';
  }
  return 'Private Rocket Launch Charter — Up to 5 Guests';
}

function assertRocketPackageRequestAllowed({ pricingPackageId, charterType, bookingMode }) {
  const packageId = String(pricingPackageId || '').trim();
  if (!packageId || !isRocketLaunchPackageId(packageId)) {
    return { ok: true };
  }
  if (String(bookingMode || '').trim().toLowerCase() !== 'charter') {
    return {
      ok: false,
      statusCode: 400,
      code: 'rocket_package_invalid_context',
      error: 'Rocket launch package pricing applies only to charter bookings.',
    };
  }
  if (normalizeRocketCharterType(charterType) !== 'rocket') {
    return {
      ok: false,
      statusCode: 400,
      code: 'rocket_package_invalid_context',
      error: 'Rocket launch package pricing applies only to rocket launch charters.',
    };
  }
  if (!isDirectRocketPackagePricingEnabled()) {
    return {
      ok: false,
      statusCode: 503,
      code: 'rocket_package_pricing_unavailable',
      error:
        'Direct rocket launch package booking is temporarily unavailable. Please call 803-542-1761 or refresh the page to continue.',
    };
  }
  return { ok: true };
}

function requiresSharedRocketMinimumAck(pkg) {
  return Boolean(pkg && String(pkg.seating || '').trim().toLowerCase() === 'shared');
}

function assertSharedRocketMinimumAcknowledged({ rocketPackage, acknowledged }) {
  if (!requiresSharedRocketMinimumAck(rocketPackage)) {
    return { ok: true };
  }
  if (!acknowledged) {
    return {
      ok: false,
      statusCode: 400,
      code: 'rocket_shared_minimum_ack_required',
      error:
        'You must acknowledge the shared charter minimum guest policy before completing checkout.',
    };
  }
  return { ok: true };
}

function resolveStaffRocketCharterPackage({ body, passengerCount }) {
  const pricingPackageId = extractPricingPackageId(body);
  if (pricingPackageId && !isRocketLaunchPackageId(pricingPackageId)) {
    return {
      ok: true,
      passengerCount,
      charterType: String(body?.charter_type || body?.charterType || 'captain_charter').trim().toLowerCase(),
      package: null,
    };
  }
  if (pricingPackageId && !isDirectRocketPackagePricingEnabled()) {
    return {
      ok: false,
      statusCode: 503,
      code: 'rocket_package_pricing_unavailable',
      error:
        'Direct rocket launch package booking is temporarily unavailable on the server. Disable package selection or enable server package pricing.',
    };
  }
  const charterTypeRaw = String(body?.charter_type || body?.charterType || '')
    .trim()
    .toLowerCase();
  const isRocket =
    Boolean(pricingPackageId && isRocketLaunchPackageId(pricingPackageId)) ||
    charterTypeRaw === 'rocket' ||
    charterTypeRaw === 'rocket_launch';
  if (!isRocket) {
    return {
      ok: true,
      passengerCount,
      charterType: charterTypeRaw || 'captain_charter',
      package: null,
    };
  }
  const rocketCheck = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId,
    passengerCountFromClient: passengerCount,
    bookingSource: String(body?.booking_source || body?.bookingSource || 'admin').toLowerCase(),
  });
  if (!rocketCheck.ok) {
    return { ok: false, error: rocketCheck.error, statusCode: rocketCheck.statusCode || 400 };
  }
  return {
    ok: true,
    passengerCount: rocketCheck.passengerCount,
    charterType: 'rocket',
    package: rocketCheck.package,
    charterVariant: rocketCheck.charterVariant,
  };
}

module.exports = {
  normalizeRocketCharterType,
  validateDirectRocketPackageCheckout,
  rocketPackageExpectedTotals,
  resolveCharterRocketPricing,
  rocketPackageBookingFields,
  stripeLineItemNameForRocketPackage,
  resolveStaffRocketCharterPackage,
  assertRocketPackageRequestAllowed,
  assertSharedRocketMinimumAcknowledged,
  requiresSharedRocketMinimumAck,
  isDirectRocketPackagePricingEnabled,
  isRocketLaunchPackageId,
};
