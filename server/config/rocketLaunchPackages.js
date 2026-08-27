/**
 * Authoritative direct-booking rocket launch packages.
 * Prices are integer cents only — never trust browser-supplied amounts.
 */

const { DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES } = require('../lib/charterDuration');

const ROCKET_LAUNCH_PACKAGES = {
  rocket_solo: {
    id: 'rocket_solo',
    name: 'Solo Rocket Launch Seat',
    guestCount: 1,
    priceCents: 10000,
    seating: 'shared',
    capacityReserved: 1,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    active: true,
  },
  rocket_duo: {
    id: 'rocket_duo',
    name: 'Rocket Launch Duo',
    guestCount: 2,
    priceCents: 19000,
    seating: 'shared',
    capacityReserved: 2,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    active: true,
  },
  rocket_three: {
    id: 'rocket_three',
    name: 'Rocket Launch for Three',
    guestCount: 3,
    priceCents: 28000,
    seating: 'shared',
    capacityReserved: 3,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    active: true,
  },
  rocket_private: {
    id: 'rocket_private',
    name: 'Private Rocket Launch Charter',
    maxGuests: 5,
    priceCents: 45000,
    seating: 'private',
    capacityReserved: 5,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    active: true,
  },
};

const ROCKET_LAUNCH_PACKAGE_IDS = Object.freeze(Object.keys(ROCKET_LAUNCH_PACKAGES));

/**
 * Direct rocket package pricing is OFF unless explicitly enabled.
 * Set DIRECT_ROCKET_PACKAGE_PRICING_ENABLED=true after deploy verification.
 * Missing or any value other than "true" keeps legacy $85×guests rocket pricing.
 */
function isDirectRocketPackagePricingEnabled() {
  return process.env.DIRECT_ROCKET_PACKAGE_PRICING_ENABLED === 'true';
}

function getRocketLaunchPackage(packageId) {
  const id = String(packageId || '').trim();
  if (!id) {
    const err = new Error('Rocket launch package is required.');
    err.statusCode = 400;
    throw err;
  }
  const pkg = ROCKET_LAUNCH_PACKAGES[id];
  if (!pkg) {
    const err = new Error(`Unknown rocket launch package: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  if (!pkg.active) {
    const err = new Error(`Rocket launch package is not available: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  return pkg;
}

function isRocketLaunchPackageId(packageId) {
  const id = String(packageId || '').trim();
  return id.startsWith('rocket_') && Boolean(ROCKET_LAUNCH_PACKAGES[id]);
}

/** Shared rocket departures need this many booked guests before the trip is operationally confirmed. */
const ROCKET_LAUNCH_MIN_GUESTS = 4;

function getCapacityReservedForPackage(pkg) {
  if (!pkg) return null;
  const reserved = Number(pkg.capacityReserved);
  if (Number.isFinite(reserved) && reserved > 0) return Math.floor(reserved);
  if (pkg.id === 'rocket_private') return 5;
  const guests = Number(pkg.guestCount);
  if (Number.isFinite(guests) && guests > 0) return Math.floor(guests);
  return null;
}

module.exports = {
  ROCKET_LAUNCH_PACKAGES,
  ROCKET_LAUNCH_PACKAGE_IDS,
  ROCKET_LAUNCH_MIN_GUESTS,
  getRocketLaunchPackage,
  getCapacityReservedForPackage,
  isDirectRocketPackagePricingEnabled,
  isRocketLaunchPackageId,
};
