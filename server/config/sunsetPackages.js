/**
 * Authoritative direct-booking Dolphin & Wildlife Tour packages
 * (route key remains experience=sunset / charterType=sunset).
 * Prices are integer cents only — never trust browser-supplied amounts.
 *
 * Shared openers: sunset_two and sunset_three.
 * Shared joiners: sunset_solo only (cannot open a departure).
 * Exclusive (entire boat): sunset_family (up to 4) and sunset_private (up to 5).
 */

const SUNSET_PACKAGE_DURATION_MINUTES = 120;

const SUNSET_PACKAGES = {
  sunset_solo: {
    id: 'sunset_solo',
    name: 'Dolphin & Wildlife Solo Seat',
    description:
      'One shared seat on a two-hour Dolphin & Wildlife Tour. Joins an existing paid shared departure only.',
    guestCount: 1,
    maxGuests: 1,
    standardValueCents: 4900,
    priceCents: 3900,
    seating: 'shared',
    canOpenSharedDeparture: false,
    capacityReserved: 1,
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
    active: true,
  },
  sunset_two: {
    id: 'sunset_two',
    name: 'Dolphin & Wildlife Tour for Two',
    description:
      'Two-guest shared tour. Opens a shared departure; remaining seats may be booked by other guests.',
    guestCount: 2,
    maxGuests: 2,
    standardValueCents: 8900,
    priceCents: 7500,
    seating: 'shared',
    canOpenSharedDeparture: true,
    capacityReserved: 2,
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
    active: true,
  },
  sunset_three: {
    id: 'sunset_three',
    name: 'Dolphin & Wildlife Tour for Three',
    description:
      'Three-guest shared tour. Opens a shared departure; remaining seats may be booked by other guests.',
    guestCount: 3,
    maxGuests: 3,
    standardValueCents: 12900,
    priceCents: 11000,
    seating: 'shared',
    canOpenSharedDeparture: true,
    capacityReserved: 3,
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
    active: true,
  },
  sunset_family: {
    id: 'sunset_family',
    name: 'Private Dolphin & Wildlife Tour for Four',
    description:
      'Private two-hour tour for up to four guests. Entire boat reserved — no other customers join.',
    guestCount: 1,
    maxGuests: 4,
    standardValueCents: 16900,
    priceCents: 14500,
    seating: 'private',
    canOpenSharedDeparture: false,
    capacityReserved: 5,
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
    active: true,
  },
  sunset_private: {
    id: 'sunset_private',
    name: 'Private Dolphin & Wildlife Tour',
    description:
      'Private two-hour tour for up to five guests. Entire boat reserved — no other customers join.',
    guestCount: 1,
    maxGuests: 5,
    standardValueCents: 20900,
    priceCents: 17900,
    seating: 'private',
    canOpenSharedDeparture: false,
    capacityReserved: 5,
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
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

function sunsetPackageDurationHours(pkg) {
  const minutes = Number(pkg?.durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return SUNSET_PACKAGE_DURATION_MINUTES / 60;
  return Math.round((minutes / 60) * 100) / 100;
}

module.exports = {
  SUNSET_PACKAGES,
  SUNSET_PACKAGE_IDS,
  SUNSET_PACKAGE_DURATION_MINUTES,
  isDirectSunsetPackagePricingEnabled,
  getSunsetPackage,
  isSunsetPackageId,
  getCapacityReservedForSunsetPackage,
  sunsetPackageSavingsCents,
  sunsetPackageDurationHours,
};
