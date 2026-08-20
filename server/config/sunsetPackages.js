/**
 * Authoritative direct-booking Sunset & Wildlife packages.
 * Prices are integer cents only — never trust browser-supplied amounts.
 *
 * Shared openers: sunset_two only (exactly $140).
 * Shared joiners: sunset_solo only (cannot open a departure).
 * Exclusive: sunset_family and sunset_private.
 */

const SUNSET_PACKAGES = {
  sunset_solo: {
    id: 'sunset_solo',
    name: 'Sunset Solo Seat',
    guestCount: 1,
    maxGuests: 1,
    standardValueCents: 8500,
    priceCents: 7500,
    seating: 'shared',
    canOpenSharedDeparture: false,
    capacityReserved: 1,
    active: true,
  },
  sunset_two: {
    id: 'sunset_two',
    name: 'Sunset for Two',
    guestCount: 2,
    maxGuests: 2,
    standardValueCents: 16000,
    priceCents: 14000,
    seating: 'shared',
    canOpenSharedDeparture: true,
    capacityReserved: 2,
    active: true,
  },
  sunset_family: {
    id: 'sunset_family',
    name: 'Sunset Family',
    guestCount: 1,
    maxGuests: 5,
    standardValueCents: 28500,
    priceCents: 25000,
    seating: 'private',
    canOpenSharedDeparture: false,
    capacityReserved: 5,
    active: true,
  },
  sunset_private: {
    id: 'sunset_private',
    name: 'Private Sunset Charter',
    guestCount: 1,
    maxGuests: 5,
    standardValueCents: 37500,
    priceCents: 32500,
    seating: 'private',
    canOpenSharedDeparture: false,
    capacityReserved: 5,
    active: true,
  },
};

const SUNSET_PACKAGE_IDS = Object.freeze(Object.keys(SUNSET_PACKAGES));

function isDirectSunsetPackagePricingEnabled() {
  return process.env.DIRECT_SUNSET_PACKAGE_PRICING_ENABLED === 'true';
}

function getSunsetPackage(packageId) {
  const id = String(packageId || '').trim();
  if (!id) {
    const err = new Error('Sunset package is required.');
    err.statusCode = 400;
    throw err;
  }
  const pkg = SUNSET_PACKAGES[id];
  if (!pkg) {
    const err = new Error(`Unknown sunset package: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  if (!pkg.active) {
    const err = new Error(`Sunset package is not available: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  return pkg;
}

function isSunsetPackageId(packageId) {
  const id = String(packageId || '').trim();
  return id.startsWith('sunset_') && Boolean(SUNSET_PACKAGES[id]);
}

function getCapacityReservedForSunsetPackage(pkg) {
  if (!pkg) return null;
  const reserved = Number(pkg.capacityReserved);
  if (Number.isFinite(reserved) && reserved > 0) return Math.floor(reserved);
  const guests = Number(pkg.guestCount);
  if (Number.isFinite(guests) && guests > 0) return Math.floor(guests);
  return null;
}

function sunsetPackageSavingsCents(pkg) {
  if (!pkg) return 0;
  return Math.max(0, Number(pkg.standardValueCents || 0) - Number(pkg.priceCents || 0));
}

module.exports = {
  SUNSET_PACKAGES,
  SUNSET_PACKAGE_IDS,
  isDirectSunsetPackagePricingEnabled,
  getSunsetPackage,
  isSunsetPackageId,
  getCapacityReservedForSunsetPackage,
  sunsetPackageSavingsCents,
};
