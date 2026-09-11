/**
 * Authoritative direct-booking bioluminescence packages.
 * Prices are integer cents only — never trust browser-supplied amounts.
 *
 * Stripe charges `priceCents` resolved from regular vs promotional config.
 * Toggle or date-bound the sale here; do not change Stripe Checkout logic.
 */

const { DateTime } = require('luxon');
const { DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES } = require('../lib/charterDuration');
const { CHARTER_MAX_PASSENGERS } = require('../charterCapacity');

const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();

/** Direct Booking Special — server decides whether it is active. */
const BIO_DIRECT_PROMOTION = {
  enabled: true,
  label: 'Direct Booking Special',
  startsAt: null,
  endsAt: null,
};

/** Four-guest package only. Never accept a client-supplied add-on amount. */
const BIO_FIFTH_PASSENGER_ADDON_CENTS = 4500;
const BIO_FIFTH_PASSENGER_ADDON_PACKAGE_ID = 'bio_four';
const BIO_FIFTH_PASSENGER_NO_CAPACITY_MESSAGE =
  'This departure does not have room for a fifth passenger.';
const BIO_FOUR_SIDEBAR_INCLUDED_LABEL = '4 passengers included.';
const BIO_FOUR_SIDEBAR_FIVE_LABEL = '5 passengers.';

const BIOLUMINESCENCE_PACKAGES = {
  bio_solo: {
    id: 'bio_solo',
    name: 'Solo Bioluminescence Tour',
    guestCount: 1,
    maxGuests: 1,
    regularPriceCents: 5850,
    promotionalPriceCents: 4499,
    badge: null,
    seating: 'shared',
    capacityReserved: 1,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    active: true,
  },
  bio_two: {
    id: 'bio_two',
    name: 'Bioluminescence Tour for Two',
    guestCount: 2,
    maxGuests: 2,
    regularPriceCents: 12000,
    promotionalPriceCents: 8999,
    badge: null,
    seating: 'shared',
    capacityReserved: 2,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    active: true,
  },
  bio_three: {
    id: 'bio_three',
    name: 'Bioluminescence Tour for Three',
    guestCount: 3,
    maxGuests: 3,
    regularPriceCents: 18000,
    promotionalPriceCents: 13499,
    badge: null,
    seating: 'shared',
    capacityReserved: 3,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    active: true,
  },
  bio_four: {
    id: 'bio_four',
    name: 'Bioluminescence Tour for Four',
    guestCount: 4,
    maxGuests: 4,
    regularPriceCents: 24000,
    promotionalPriceCents: 17999,
    badge: 'Best Value',
    seating: 'shared',
    capacityReserved: 4,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    allowsFifthPassengerAddon: true,
    active: true,
  },
  bio_private: {
    id: 'bio_private',
    name: 'Private Bioluminescence Tour',
    guestCount: 1,
    maxGuests: 5,
    regularPriceCents: 24999,
    promotionalPriceCents: 24999,
    badge: 'Private',
    seating: 'private',
    capacityReserved: 5,
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
    description:
      'Reserve the entire boat for your group of up to 5 guests and choose from any available departure time.',
    active: true,
  },
};

const BIOLUMINESCENCE_PACKAGE_IDS = Object.freeze(Object.keys(BIOLUMINESCENCE_PACKAGES));

/**
 * Direct bio package pricing (BookNow + Stripe) is OFF unless explicitly enabled.
 * Set DIRECT_BIO_PACKAGE_PRICING_ENABLED=true in production after migration + deploy.
 * Missing, empty, or any value other than "true" keeps legacy $150×guests direct bio pricing.
 */
function isDirectBioPackagePricingEnabled() {
  return process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED === 'true';
}

function parsePromotionBound(raw, { endOfDay } = {}) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let dt = DateTime.fromISO(text, { zone: BUSINESS_TZ });
  if (!dt.isValid) return null;
  if (endOfDay && !text.includes('T')) {
    dt = dt.endOf('day');
  }
  return dt;
}

function asBusinessDateTime(now) {
  if (now && typeof now.toMillis === 'function') {
    return now.setZone(BUSINESS_TZ);
  }
  if (now instanceof Date) {
    return DateTime.fromJSDate(now, { zone: BUSINESS_TZ });
  }
  if (typeof now === 'string' && now.trim()) {
    const parsed = DateTime.fromISO(now.trim(), { zone: BUSINESS_TZ });
    if (parsed.isValid) return parsed;
  }
  return DateTime.now().setZone(BUSINESS_TZ);
}

function isBioDirectPromotionActive(now) {
  if (!BIO_DIRECT_PROMOTION.enabled) return false;
  const current = asBusinessDateTime(now);
  const startsAt = parsePromotionBound(BIO_DIRECT_PROMOTION.startsAt);
  if (startsAt && current < startsAt) return false;
  const endsAt = parsePromotionBound(BIO_DIRECT_PROMOTION.endsAt, { endOfDay: true });
  if (endsAt && current > endsAt) return false;
  return true;
}

function resolveBioPackageChargeCents(pkg, now) {
  if (isBioDirectPromotionActive(now)) {
    return Number(pkg.promotionalPriceCents);
  }
  return Number(pkg.regularPriceCents);
}

function bioPackageAllowsFifthPassengerAddon(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  return (
    String(pkg.id || '').trim() === BIO_FIFTH_PASSENGER_ADDON_PACKAGE_ID &&
    pkg.allowsFifthPassengerAddon === true
  );
}

function isBioPrivatePackageId(packageId) {
  return String(packageId || '').trim() === 'bio_private';
}

function isBioluminescencePackageId(packageId) {
  const id = String(packageId || '').trim();
  return Boolean(id) && Object.prototype.hasOwnProperty.call(BIOLUMINESCENCE_PACKAGES, id);
}

function getCapacityReservedForBioPackage(pkg) {
  if (!pkg) return null;
  if (isBioPrivatePackageId(pkg.id)) return CHARTER_MAX_PASSENGERS;
  const reserved = Number(pkg.capacityReserved);
  if (Number.isFinite(reserved) && reserved > 0) return Math.floor(reserved);
  const guests = Number(pkg.guestCount);
  if (Number.isFinite(guests) && guests > 0) return Math.floor(guests);
  return null;
}

function getBioluminescencePackage(packageId, options = {}) {
  const id = String(packageId || '').trim();
  if (!id) {
    const err = new Error('Bioluminescence package is required.');
    err.statusCode = 400;
    throw err;
  }
  const pkg = BIOLUMINESCENCE_PACKAGES[id];
  if (!pkg) {
    const err = new Error(`Unknown bioluminescence package: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  if (!pkg.active) {
    const err = new Error(`Bioluminescence package is not available: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  const promotionActive = isBioDirectPromotionActive(options.now);
  const priceCents = resolveBioPackageChargeCents(pkg, options.now);
  return {
    ...pkg,
    priceCents,
    standardValueCents: Number(pkg.regularPriceCents),
    promotionActive,
    promotionLabel: promotionActive ? BIO_DIRECT_PROMOTION.label : null,
  };
}

module.exports = {
  BIOLUMINESCENCE_PACKAGES,
  BIOLUMINESCENCE_PACKAGE_IDS,
  BIO_DIRECT_PROMOTION,
  BIO_FIFTH_PASSENGER_ADDON_CENTS,
  BIO_FIFTH_PASSENGER_ADDON_PACKAGE_ID,
  BIO_FIFTH_PASSENGER_NO_CAPACITY_MESSAGE,
  BIO_FOUR_SIDEBAR_INCLUDED_LABEL,
  BIO_FOUR_SIDEBAR_FIVE_LABEL,
  bioPackageAllowsFifthPassengerAddon,
  getBioluminescencePackage,
  getCapacityReservedForBioPackage,
  isBioPrivatePackageId,
  isBioluminescencePackageId,
  isDirectBioPackagePricingEnabled,
  isBioDirectPromotionActive,
  resolveBioPackageChargeCents,
};
