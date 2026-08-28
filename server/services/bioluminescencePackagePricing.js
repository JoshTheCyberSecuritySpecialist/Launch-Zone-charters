const {
  getBioluminescencePackage,
  isDirectBioPackagePricingEnabled,
  bioPackageAllowsFifthPassengerAddon,
  BIO_FIFTH_PASSENGER_ADDON_CENTS,
  BIO_FIFTH_PASSENGER_NO_CAPACITY_MESSAGE,
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

function parseFifthPassengerAddonRequested(value) {
  if (value === true || value === 1) return true;
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function extractFifthPassengerAddonFromBooking(booking) {
  if (!booking || typeof booking !== 'object') return false;
  return parseFifthPassengerAddonRequested(
    booking.fifthPassengerAddon ??
      booking.fifth_passenger_addon ??
      booking.addFifthPassenger ??
      booking.add_fifth_passenger
  );
}

function validateDirectBioPackageCheckout({
  charterType,
  pricingPackageId,
  passengerCountFromClient,
  bookingSource,
  fifthPassengerAddonFromClient,
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

  const addonRequested = parseFifthPassengerAddonRequested(fifthPassengerAddonFromClient);
  if (addonRequested && !bioPackageAllowsFifthPassengerAddon(pkg)) {
    return {
      ok: false,
      error: 'The fifth-passenger option is only available on the four-guest bioluminescence package.',
    };
  }

  const clientCountRaw = Number(passengerCountFromClient);
  const clientCount = Number.isFinite(clientCountRaw) ? Math.max(1, Math.round(clientCountRaw)) : NaN;

  if (addonRequested) {
    if (Number.isFinite(clientCount) && clientCount !== pkg.guestCount && clientCount !== 5) {
      return {
        ok: false,
        error: 'Guest count must be 5 when adding a fifth passenger.',
      };
    }
    if (Number.isFinite(clientCount) && clientCount > 5) {
      return {
        ok: false,
        error: 'Charter bookings allow up to 5 passengers (plus captain).',
      };
    }
    return {
      ok: true,
      package: pkg,
      passengerCount: 5,
      fifthPassengerAddon: true,
    };
  }

  if (Number.isFinite(clientCount)) {
    if (clientCount !== pkg.guestCount) {
      return {
        ok: false,
        error: `Guest count must match the selected package (${pkg.guestCount} guests).`,
      };
    }
  }

  return {
    ok: true,
    package: pkg,
    passengerCount: pkg.guestCount,
    fifthPassengerAddon: false,
  };
}

function bioPackageExpectedTotals(pkg, { fifthPassengerAddon } = {}) {
  const addon = Boolean(fifthPassengerAddon) && bioPackageAllowsFifthPassengerAddon(pkg);
  const addonCents = addon ? BIO_FIFTH_PASSENGER_ADDON_CENTS : 0;
  const totalCents = Number(pkg.priceCents) + addonCents;
  const guests = addon ? 5 : pkg.guestCount;
  const totalPrice = roundMoney(totalCents / 100);
  const ticketPrice = roundMoney(totalPrice / guests);
  return {
    mode: 'charter',
    basePrice: totalPrice,
    ticketPrice,
    guestCount: guests,
    durationHours: 1,
    totalPrice,
    amountDueToday: totalPrice,
    charterVariant: 'shared',
    bioPackage: pkg,
    fifthPassengerAddon: addon,
    fifthPassengerAddonCents: addonCents,
  };
}

function resolveCharterBioPricing({
  charterType,
  pricingPackageId,
  passengerCount,
  bookingSource,
  fifthPassengerAddon,
}) {
  const validated = validateDirectBioPackageCheckout({
    charterType,
    pricingPackageId,
    passengerCountFromClient: passengerCount,
    bookingSource,
    fifthPassengerAddonFromClient: fifthPassengerAddon,
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
    fifthPassengerAddon: Boolean(validated.fifthPassengerAddon),
    totals: bioPackageExpectedTotals(validated.package, {
      fifthPassengerAddon: validated.fifthPassengerAddon,
    }),
  };
}

function bioPackageBookingFields(pkg, { fifthPassengerAddon } = {}) {
  const totals = bioPackageExpectedTotals(pkg, { fifthPassengerAddon });
  const chargedCents = Math.round(totals.totalPrice * 100);
  const regularCents = Number(pkg.regularPriceCents ?? pkg.standardValueCents ?? pkg.priceCents);
  const discountCents = Math.max(0, regularCents - Number(pkg.priceCents));
  return {
    pricing_package_id: pkg.id,
    pricing_package_name: pkg.name,
    package_guest_count: totals.guestCount,
    standard_value_cents: regularCents,
    package_price_cents: chargedCents,
    discount_amount_cents: discountCents,
    final_amount_cents: chargedCents,
  };
}

function stripeLineItemNameForBioPackage(pkg, { fifthPassengerAddon } = {}) {
  const addon = Boolean(fifthPassengerAddon) && bioPackageAllowsFifthPassengerAddon(pkg);
  if (pkg.id === 'bio_solo') {
    return 'Solo Bioluminescence Night Tour — 1 Guest';
  }
  if (addon) {
    return 'Bioluminescence Night Tour — 5 Guests';
  }
  return `Bioluminescence Night Tour — ${pkg.guestCount} Guests`;
}

function stripeLineItemsForBioPackage(pkg, { fifthPassengerAddon } = {}) {
  const addon = Boolean(fifthPassengerAddon) && bioPackageAllowsFifthPassengerAddon(pkg);
  const items = [
    {
      name: stripeLineItemNameForBioPackage(pkg),
      unit_amount: Number(pkg.priceCents),
    },
  ];
  if (addon) {
    items.push({
      name: 'Additional 5th passenger',
      unit_amount: BIO_FIFTH_PASSENGER_ADDON_CENTS,
    });
  }
  return items;
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
    fifthPassengerAddonFromClient: extractFifthPassengerAddonFromBooking(body),
  });
  if (!bioCheck.ok) {
    return { ok: false, error: bioCheck.error, statusCode: bioCheck.statusCode || 400 };
  }
  return {
    ok: true,
    passengerCount: bioCheck.passengerCount,
    charterType: 'bio',
    package: bioCheck.package,
    fifthPassengerAddon: Boolean(bioCheck.fifthPassengerAddon),
  };
}

module.exports = {
  normalizeBioCharterType,
  extractPricingPackageId,
  extractFifthPassengerAddonFromBooking,
  parseFifthPassengerAddonRequested,
  validateDirectBioPackageCheckout,
  bioPackageExpectedTotals,
  resolveCharterBioPricing,
  bioPackageBookingFields,
  stripeLineItemNameForBioPackage,
  stripeLineItemsForBioPackage,
  resolveStaffBioCharterPackage,
  assertBioPackageRequestAllowed,
  isDirectBioPackagePricingEnabled,
  BIO_FIFTH_PASSENGER_ADDON_CENTS,
  BIO_FIFTH_PASSENGER_NO_CAPACITY_MESSAGE,
};
