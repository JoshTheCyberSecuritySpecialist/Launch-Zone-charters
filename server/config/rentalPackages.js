/**
 * Authoritative direct-booking rental policy.
 * Prices are integer cents — never trust browser-supplied amounts for Stripe.
 *
 * Fleet: pontoon and Key Largo center console share 4h/6h structure and schedule
 * rules, but resolve independent priceCents from stable boat IDs.
 *
 * Historical notes:
 * - `half_day` / 4h and `full_day` / 8h remain valid for Groupon voucher mappings.
 * - 8-hour is NOT an active direct-booking package.
 * - 6-hour uses package id `rental_6hr` with rental_type `hourly` for DB compatibility
 *   (bookings.rental_type CHECK allows hourly|half_day|full_day|custom); price comes from
 *   this config, not boats.hourly_rate.
 * - Commit 88dd9b4 introduced shared pontoon package prices for all boats; fleet
 *   pricing restores boat-specific cents without changing DB boat rates.
 */

const { DateTime } = require('luxon');

const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();

/** Day window: rentals may start at open and must be returned by close (hour:00 local). */
const RENTAL_OPEN_HOUR = 6;
const RENTAL_CLOSE_HOUR = 17;
const RENTAL_SLOT_STEP_MINUTES = 60;
const RENTAL_ALLOWED_DIRECT_DURATIONS = Object.freeze([4, 6]);
/** Listing may still generate 8h starts for legacy Groupon vouchers (must finish by close). */
const RENTAL_ALLOWED_LISTING_DURATIONS = Object.freeze([4, 6, 8]);
/** Marketed passenger cap for direct packages (boat USCG capacity may be higher). */
const RENTAL_MAX_PASSENGERS = 6;

const RENTAL_FLEET = Object.freeze({
  PONTOON: 'pontoon',
  CENTER_CONSOLE: 'center_console',
});

/** Production boat UUIDs (override via env comma-lists if needed). */
const DEFAULT_PONTOON_BOAT_IDS = Object.freeze(['a68bdf6b-be8d-48ad-971a-ac1854eb45da']);
const DEFAULT_CENTER_CONSOLE_BOAT_IDS = Object.freeze(['8847383e-0f4a-4b82-b3dd-e7c0133e3a97']);

const RENTAL_FLEET_PRICE_CENTS = Object.freeze({
  [RENTAL_FLEET.PONTOON]: Object.freeze({ 4: 14999, 6: 20999 }),
  [RENTAL_FLEET.CENTER_CONSOLE]: Object.freeze({ 4: 29999, 6: 44999 }),
});

const RENTAL_FLEET_LABEL = Object.freeze({
  [RENTAL_FLEET.PONTOON]: 'Pontoon',
  [RENTAL_FLEET.CENTER_CONSOLE]: 'Center Console',
});

const RENTAL_PACKAGE_IDS = Object.freeze({
  FOUR_HOUR: 'rental_4hr',
  SIX_HOUR: 'rental_6hr',
});

/** Structural package defs (duration/type). priceCents filled per fleet at resolve time. */
const RENTAL_PACKAGE_DEFS = Object.freeze({
  [RENTAL_PACKAGE_IDS.FOUR_HOUR]: Object.freeze({
    id: RENTAL_PACKAGE_IDS.FOUR_HOUR,
    durationHours: 4,
    rentalType: 'half_day',
    maxPassengers: RENTAL_MAX_PASSENGERS,
    active: true,
    directBooking: true,
  }),
  [RENTAL_PACKAGE_IDS.SIX_HOUR]: Object.freeze({
    id: RENTAL_PACKAGE_IDS.SIX_HOUR,
    durationHours: 6,
    /** DB-safe enum value; Stripe/base price uses fleet priceCents, not boat hourly_rate. */
    rentalType: 'hourly',
    maxPassengers: RENTAL_MAX_PASSENGERS,
    active: true,
    directBooking: true,
  }),
});

function parseBoatIdList(envVal, defaults) {
  const raw = String(envVal || '').trim();
  if (!raw) return [...defaults];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function buildBoatIdFleetMap() {
  const map = new Map();
  for (const id of parseBoatIdList(process.env.RENTAL_PONTOON_BOAT_IDS, DEFAULT_PONTOON_BOAT_IDS)) {
    map.set(id, RENTAL_FLEET.PONTOON);
  }
  for (const id of parseBoatIdList(
    process.env.RENTAL_CENTER_CONSOLE_BOAT_IDS,
    DEFAULT_CENTER_CONSOLE_BOAT_IDS
  )) {
    map.set(id, RENTAL_FLEET.CENTER_CONSOLE);
  }
  return map;
}

const BOAT_ID_FLEET_MAP = buildBoatIdFleetMap();

/**
 * Resolve rental fleet from stable boat UUID first.
 * Name tokens are a last-resort fallback for unmapped local/dev boat rows only.
 */
function resolveRentalFleet({ boatId = null, boatName = null } = {}) {
  const id = String(boatId || '')
    .trim()
    .toLowerCase();
  if (id && BOAT_ID_FLEET_MAP.has(id)) {
    return BOAT_ID_FLEET_MAP.get(id);
  }
  const name = String(boatName || '').toLowerCase();
  if (/key\s*largo|center\s*console/.test(name)) {
    return RENTAL_FLEET.CENTER_CONSOLE;
  }
  return RENTAL_FLEET.PONTOON;
}

function priceCentsForFleetDuration(fleet, durationHours) {
  const table = RENTAL_FLEET_PRICE_CENTS[fleet] || RENTAL_FLEET_PRICE_CENTS[RENTAL_FLEET.PONTOON];
  const d = Number(durationHours);
  if (Math.abs(d - 4) < 0.01) return table[4];
  if (Math.abs(d - 6) < 0.01) return table[6];
  return null;
}

function packageForFleet(def, fleet) {
  const priceCents = priceCentsForFleetDuration(fleet, def.durationHours);
  const label = RENTAL_FLEET_LABEL[fleet] || RENTAL_FLEET_LABEL[RENTAL_FLEET.PONTOON];
  return Object.freeze({
    id: def.id,
    name: `${def.durationHours}-Hour ${label} Rental`,
    durationHours: def.durationHours,
    priceCents,
    rentalType: def.rentalType,
    maxPassengers: def.maxPassengers,
    active: def.active,
    directBooking: def.directBooking,
    fleet,
  });
}

/** Default pontoon-priced packages (backward-compatible export shape). */
const RENTAL_PACKAGES = Object.freeze({
  [RENTAL_PACKAGE_IDS.FOUR_HOUR]: packageForFleet(
    RENTAL_PACKAGE_DEFS[RENTAL_PACKAGE_IDS.FOUR_HOUR],
    RENTAL_FLEET.PONTOON
  ),
  [RENTAL_PACKAGE_IDS.SIX_HOUR]: packageForFleet(
    RENTAL_PACKAGE_DEFS[RENTAL_PACKAGE_IDS.SIX_HOUR],
    RENTAL_FLEET.PONTOON
  ),
});

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function centsToUsd(cents) {
  return roundMoney(Number(cents) / 100);
}

function normalizeDurationHours(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function isAllowedDirectDuration(durationHours) {
  const d = normalizeDurationHours(durationHours);
  return d != null && RENTAL_ALLOWED_DIRECT_DURATIONS.some((x) => Math.abs(x - d) < 0.01);
}

function isAllowedListingDuration(durationHours) {
  const d = normalizeDurationHours(durationHours);
  return d != null && RENTAL_ALLOWED_LISTING_DURATIONS.some((x) => Math.abs(x - d) < 0.01);
}

function getRentalPackage(packageId, { boatId = null, boatName = null } = {}) {
  const id = String(packageId || '').trim();
  const def = RENTAL_PACKAGE_DEFS[id];
  if (!def) return null;
  const fleet = resolveRentalFleet({ boatId, boatName });
  return packageForFleet(def, fleet);
}

function listActiveDirectRentalPackages({ boatId = null, boatName = null } = {}) {
  const fleet = resolveRentalFleet({ boatId, boatName });
  return Object.values(RENTAL_PACKAGE_DEFS)
    .filter((p) => p.active && p.directBooking)
    .map((def) => packageForFleet(def, fleet));
}

/**
 * Resolve direct-booking package from package id and/or duration / rental_type.
 * Does not resolve Groupon full_day / 8h vouchers.
 * When boatId (preferred) or boatName is provided, priceCents is fleet-specific.
 */
function resolveDirectRentalPackage({
  packageId = null,
  durationHours = null,
  rentalType = null,
  boatId = null,
  boatName = null,
} = {}) {
  const fleet = resolveRentalFleet({ boatId, boatName });
  const fromId = getRentalPackage(packageId, { boatId, boatName });
  if (fromId) {
    if (!fromId.active || !fromId.directBooking) {
      return { ok: false, error: 'This rental package is not available for direct booking.', statusCode: 400 };
    }
    const duration = normalizeDurationHours(durationHours);
    if (duration != null && Math.abs(duration - fromId.durationHours) > 0.01) {
      return {
        ok: false,
        error: `Duration must be ${fromId.durationHours} hours for this package.`,
        statusCode: 400,
      };
    }
    const rt = String(rentalType || '').trim().toLowerCase();
    if (rt && rt !== fromId.rentalType) {
      return {
        ok: false,
        error: 'Rental type does not match the selected package.',
        statusCode: 400,
      };
    }
    return { ok: true, package: fromId };
  }

  const duration = normalizeDurationHours(durationHours);
  const rt = String(rentalType || '').trim().toLowerCase();

  if (rt === 'full_day' || (duration != null && Math.abs(duration - 8) < 0.01)) {
    return {
      ok: false,
      error: '8-hour rentals are not available for direct online booking. Choose 4 or 6 hours.',
      statusCode: 400,
    };
  }

  if (duration != null) {
    const match = listActiveDirectRentalPackages({ boatId, boatName }).find(
      (p) => Math.abs(p.durationHours - duration) < 0.01
    );
    if (match) {
      if (rt && rt !== match.rentalType) {
        return {
          ok: false,
          error: 'Rental type does not match the selected duration.',
          statusCode: 400,
        };
      }
      return { ok: true, package: match };
    }
  }

  if (rt === 'half_day') {
    return {
      ok: true,
      package: packageForFleet(RENTAL_PACKAGE_DEFS[RENTAL_PACKAGE_IDS.FOUR_HOUR], fleet),
    };
  }

  return {
    ok: false,
    error: 'Choose a 4-hour or 6-hour rental package.',
    statusCode: 400,
  };
}

/**
 * Map duration to bookings.rental_type for inserts (preserves half_day/full_day semantics).
 */
function rentalTypeForDurationHours(hours, { allowLegacyFullDay = false } = {}) {
  const d = normalizeDurationHours(hours);
  if (d == null) return 'hourly';
  if (Math.abs(d - 4) < 0.01) return 'half_day';
  if (Math.abs(d - 6) < 0.01) return RENTAL_PACKAGE_DEFS[RENTAL_PACKAGE_IDS.SIX_HOUR].rentalType;
  if (Math.abs(d - 8) < 0.01 && allowLegacyFullDay) return 'full_day';
  return 'hourly';
}

function packageIdForDurationHours(hours) {
  const resolved = resolveDirectRentalPackage({ durationHours: hours });
  return resolved.ok ? resolved.package.id : null;
}

function basePriceUsdForDirectPackage(pkg) {
  return centsToUsd(pkg.priceCents);
}

/**
 * Validate rental start/end against policy window (America/New_York).
 * @param {'direct'|'staff'|'groupon'|'listing'} mode
 */
function validateRentalSchedule({
  startIso,
  endIso,
  durationHours,
  mode = 'direct',
} = {}) {
  const start = DateTime.fromISO(String(startIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  const end = DateTime.fromISO(String(endIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!start.isValid || !end.isValid) {
    return { ok: false, error: 'Invalid start or end time.', statusCode: 400, code: 'invalid_time' };
  }
  if (end.toMillis() <= start.toMillis()) {
    return { ok: false, error: 'End time must be after start time.', statusCode: 400, code: 'invalid_range' };
  }

  const duration = normalizeDurationHours(durationHours);
  if (duration == null) {
    return { ok: false, error: 'Invalid duration hours.', statusCode: 400, code: 'invalid_duration' };
  }

  const computedHours = end.diff(start, 'hours').hours;
  if (Math.abs(computedHours - duration) > 0.01) {
    return {
      ok: false,
      error: 'End time must equal start time plus duration.',
      statusCode: 400,
      code: 'duration_mismatch',
    };
  }

  if (mode === 'direct' || mode === 'staff') {
    if (!isAllowedDirectDuration(duration)) {
      return {
        ok: false,
        error: 'Rentals must be exactly 4 or 6 hours.',
        statusCode: 400,
        code: 'invalid_duration',
      };
    }
  } else if (mode === 'groupon' || mode === 'listing') {
    if (!isAllowedListingDuration(duration)) {
      return {
        ok: false,
        error: 'Unsupported rental duration.',
        statusCode: 400,
        code: 'invalid_duration',
      };
    }
  }

  const openMinutes = RENTAL_OPEN_HOUR * 60;
  const startMinutes = start.hour * 60 + start.minute;
  if (startMinutes < openMinutes) {
    return {
      ok: false,
      error: 'Rentals cannot start before 6:00 AM.',
      statusCode: 400,
      code: 'before_open',
    };
  }

  if (start.minute !== 0 || start.second !== 0 || start.millisecond !== 0) {
    return {
      ok: false,
      error: 'Rental start times must be on the hour.',
      statusCode: 400,
      code: 'non_hourly_start',
    };
  }

  if (end.hour > RENTAL_CLOSE_HOUR || (end.hour === RENTAL_CLOSE_HOUR && (end.minute > 0 || end.second > 0 || end.millisecond > 0))) {
    return {
      ok: false,
      error: 'Rentals must be returned by 5:00 PM.',
      statusCode: 400,
      code: 'after_close',
    };
  }

  // Same-day: if end is next calendar day, reject (overnight rentals not allowed).
  if (end.toISODate() !== start.toISODate()) {
    return {
      ok: false,
      error: 'Rentals must start and end on the same calendar day and return by 5:00 PM.',
      statusCode: 400,
      code: 'cross_day',
    };
  }

  return {
    ok: true,
    start,
    end,
    durationHours: duration,
    openHour: RENTAL_OPEN_HOUR,
    closeHour: RENTAL_CLOSE_HOUR,
  };
}

function assertValidRentalSchedule(input) {
  const result = validateRentalSchedule(input);
  if (result.ok) return result;
  const err = new Error(result.error || 'Invalid rental schedule.');
  err.statusCode = result.statusCode || 400;
  err.code = result.code || 'invalid_rental_schedule';
  throw err;
}

/** Valid hourly starts for a duration that finish by close. */
function listValidStartHoursForDuration(durationHours) {
  const duration = normalizeDurationHours(durationHours);
  if (duration == null) return [];
  const lastStart = RENTAL_CLOSE_HOUR - duration;
  if (lastStart < RENTAL_OPEN_HOUR) return [];
  const hours = [];
  for (let h = RENTAL_OPEN_HOUR; h <= lastStart; h += 1) {
    hours.push(h);
  }
  return hours;
}

module.exports = {
  BUSINESS_TZ,
  RENTAL_OPEN_HOUR,
  RENTAL_CLOSE_HOUR,
  RENTAL_SLOT_STEP_MINUTES,
  RENTAL_ALLOWED_DIRECT_DURATIONS,
  RENTAL_ALLOWED_LISTING_DURATIONS,
  RENTAL_MAX_PASSENGERS,
  RENTAL_FLEET,
  DEFAULT_PONTOON_BOAT_IDS,
  DEFAULT_CENTER_CONSOLE_BOAT_IDS,
  RENTAL_FLEET_PRICE_CENTS,
  RENTAL_PACKAGE_IDS,
  RENTAL_PACKAGES,
  centsToUsd,
  resolveRentalFleet,
  getRentalPackage,
  listActiveDirectRentalPackages,
  resolveDirectRentalPackage,
  rentalTypeForDurationHours,
  packageIdForDurationHours,
  basePriceUsdForDirectPackage,
  normalizeDurationHours,
  isAllowedDirectDuration,
  isAllowedListingDuration,
  validateRentalSchedule,
  assertValidRentalSchedule,
  listValidStartHoursForDuration,
};
