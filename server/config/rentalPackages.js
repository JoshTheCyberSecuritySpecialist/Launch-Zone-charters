/**
 * Authoritative direct-booking pontoon rental policy.
 * Prices are integer cents — never trust browser-supplied amounts for Stripe.
 *
 * Historical notes:
 * - `half_day` / 4h and `full_day` / 8h remain valid for Groupon voucher mappings.
 * - 8-hour is NOT an active direct-booking package.
 * - 6-hour uses package id `rental_6hr` with rental_type `hourly` for DB compatibility
 *   (bookings.rental_type CHECK allows hourly|half_day|full_day|custom); price comes from
 *   this config, not boats.hourly_rate.
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

const RENTAL_PACKAGE_IDS = Object.freeze({
  FOUR_HOUR: 'rental_4hr',
  SIX_HOUR: 'rental_6hr',
});

const RENTAL_PACKAGES = Object.freeze({
  [RENTAL_PACKAGE_IDS.FOUR_HOUR]: Object.freeze({
    id: RENTAL_PACKAGE_IDS.FOUR_HOUR,
    name: '4-Hour Pontoon Rental',
    durationHours: 4,
    priceCents: 14999,
    rentalType: 'half_day',
    maxPassengers: RENTAL_MAX_PASSENGERS,
    active: true,
    directBooking: true,
  }),
  [RENTAL_PACKAGE_IDS.SIX_HOUR]: Object.freeze({
    id: RENTAL_PACKAGE_IDS.SIX_HOUR,
    name: '6-Hour Pontoon Rental',
    durationHours: 6,
    priceCents: 20999,
    /** DB-safe enum value; Stripe/base price uses priceCents, not boat hourly_rate. */
    rentalType: 'hourly',
    maxPassengers: RENTAL_MAX_PASSENGERS,
    active: true,
    directBooking: true,
  }),
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

function getRentalPackage(packageId) {
  const id = String(packageId || '').trim();
  return RENTAL_PACKAGES[id] || null;
}

function listActiveDirectRentalPackages() {
  return Object.values(RENTAL_PACKAGES).filter((p) => p.active && p.directBooking);
}

/**
 * Resolve direct-booking package from package id and/or duration / rental_type.
 * Does not resolve Groupon full_day / 8h vouchers.
 */
function resolveDirectRentalPackage({
  packageId = null,
  durationHours = null,
  rentalType = null,
} = {}) {
  const fromId = getRentalPackage(packageId);
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
    const match = listActiveDirectRentalPackages().find((p) => Math.abs(p.durationHours - duration) < 0.01);
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
    return { ok: true, package: RENTAL_PACKAGES[RENTAL_PACKAGE_IDS.FOUR_HOUR] };
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
  if (Math.abs(d - 6) < 0.01) return RENTAL_PACKAGES[RENTAL_PACKAGE_IDS.SIX_HOUR].rentalType;
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
  RENTAL_PACKAGE_IDS,
  RENTAL_PACKAGES,
  centsToUsd,
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
