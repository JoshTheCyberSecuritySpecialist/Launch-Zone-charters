const {
  getBioluminescencePackage,
  isDirectBioPackagePricingEnabled,
} = require('../config/bioluminescencePackages');

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeBioCharterType(charterType) {
  const t = String(charterType || '').trim().toLowerCase();
  if (t === 'bio' || t === 'night_bio') return 'bio';
  return t;
}

function extractPricingPackageId(booking) {
  if (!booking || typeof booking !== 'object') return '';
  return String(
    booking.pricingPackageId ||
      booking.pricing_package_id ||
      booking.packageId ||
      booking.package ||
      ''
  ).trim();
}

function validateDirectBioPackageCheckout({
  charterType,
  pricingPackageId,
  passengerCountFromClient,
  bookingSource,
}) {
  if (!isDirectBioPackagePricingEnabled()) {
    return { ok: true, useLegacy: true };
  }
  if (normalizeBioCharterType(charterType) !== 'bio') {
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
      error:
        'Select a bioluminescence package (solo, two, three, or four guests) to continue.',
    };
  }

  let pkg;
  try {
    pkg = getBioluminescencePackage(packageId);
  } catch (e) {
    return { ok: false, error: e.message || 'Invalid bioluminescence package.' };
  }

  const clientCountRaw = Number(passengerCountFromClient);
  if (Number.isFinite(clientCountRaw)) {
    const clientCount = Math.max(1, Math.round(clientCountRaw));
    if (clientCount !== pkg.guestCount) {
      return {
        ok: false,
        error: `Guest count must match the selected package (${pkg.guestCount} guests).`,
      };
    }
  }

  return { ok: true, package: pkg, passengerCount: pkg.guestCount };
}

function bioPackageExpectedTotals(pkg) {
  const totalPrice = roundMoney(pkg.priceCents / 100);
  const ticketPrice = roundMoney(totalPrice / pkg.guestCount);
  return {
    mode: 'charter',
    basePrice: totalPrice,
    ticketPrice,
    guestCount: pkg.guestCount,
    durationHours: 1,
    totalPrice,
    amountDueToday: totalPrice,
    charterVariant: 'shared',
    bioPackage: pkg,
  };
}

function resolveCharterBioPricing({
  charterType,
  pricingPackageId,
  passengerCount,
  bookingSource,
}) {
  const validated = validateDirectBioPackageCheckout({
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
    totals: bioPackageExpectedTotals(validated.package),
  };
}

function bioPackageBookingFields(pkg) {
  const chargedCents = Number(pkg.priceCents);
  const regularCents = Number(pkg.regularPriceCents ?? pkg.standardValueCents ?? chargedCents);
  const discountCents = Math.max(0, regularCents - chargedCents);
  return {
    pricing_package_id: pkg.id,
    pricing_package_name: pkg.name,
    package_guest_count: pkg.guestCount,
    standard_value_cents: regularCents,
    package_price_cents: chargedCents,
    discount_amount_cents: discountCents,
    final_amount_cents: chargedCents,
  };
}

function stripeLineItemNameForBioPackage(pkg) {
  if (pkg.id === 'bio_solo') {
    return 'Solo Bioluminescence Night Tour — 1 Guest';
  }
  return `Bioluminescence Night Tour — ${pkg.guestCount} Guests`;
}

function assertBioPackageRequestAllowed({ pricingPackageId, charterType, bookingMode }) {
  const packageId = String(pricingPackageId || '').trim();
  if (!packageId) {
    return { ok: true };
  }
  if (String(bookingMode || '').trim().toLowerCase() !== 'charter') {
    return {
      ok: false,
      statusCode: 400,
      code: 'bio_package_invalid_context',
      error: 'Bioluminescence package pricing applies only to charter bookings.',
    };
  }
  const bioType = normalizeBioCharterType(charterType);
  if (bioType !== 'bio') {
    return {
      ok: false,
      statusCode: 400,
      code: 'bio_package_invalid_context',
      error: 'Bioluminescence package pricing applies only to bioluminescence night tours.',
    };
  }
  if (!isDirectBioPackagePricingEnabled()) {
    return {
      ok: false,
      statusCode: 503,
      code: 'bio_package_pricing_unavailable',
      error:
        'Direct bioluminescence package booking is temporarily unavailable. Please call 803-542-1761 or refresh the page to continue.',
    };
  }
  return { ok: true };
}

function resolveStaffBioCharterPackage({ body, passengerCount }) {
  const pricingPackageId = extractPricingPackageId(body);
  if (pricingPackageId && !isDirectBioPackagePricingEnabled()) {
    return {
      ok: false,
      statusCode: 503,
      code: 'bio_package_pricing_unavailable',
      error:
        'Direct bioluminescence package booking is temporarily unavailable on the server. Disable package selection or enable server package pricing.',
    };
  }
  const charterTypeRaw = String(body?.charter_type || body?.charterType || '')
    .trim()
    .toLowerCase();
  const isBio =
    Boolean(pricingPackageId) || charterTypeRaw === 'bio' || charterTypeRaw === 'night_bio';
  if (!isBio) {
    return {
      ok: true,
      passengerCount,
      charterType: charterTypeRaw || 'captain_charter',
      package: null,
    };
  }
  const bioCheck = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId,
    passengerCountFromClient: passengerCount,
    bookingSource: String(body?.booking_source || body?.bookingSource || 'admin').toLowerCase(),
  });
  if (!bioCheck.ok) {
    return { ok: false, error: bioCheck.error, statusCode: bioCheck.statusCode || 400 };
  }
  return {
    ok: true,
    passengerCount: bioCheck.passengerCount,
    charterType: 'bio',
    package: bioCheck.package,
  };
}

module.exports = {
  normalizeBioCharterType,
  extractPricingPackageId,
  validateDirectBioPackageCheckout,
  bioPackageExpectedTotals,
  resolveCharterBioPricing,
  bioPackageBookingFields,
  stripeLineItemNameForBioPackage,
  resolveStaffBioCharterPackage,
  assertBioPackageRequestAllowed,
  isDirectBioPackagePricingEnabled,
};
