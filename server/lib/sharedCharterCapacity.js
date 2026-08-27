const { CHARTER_MAX_PASSENGERS, validateCharterPassengerCount } = require('../charterCapacity');

/** Missing/invalid guest_count on a blocking row — assume full charter (safe). */
const UNKNOWN_GUEST_COUNT_ASSUMES = CHARTER_MAX_PASSENGERS;

const BLOCKING_BOOKING_STATUSES = new Set([
  'hold',
  'pending',
  'pending_verification',
  'confirmed',
  'ready_for_departure',
  'completed',
]);

const SHARED_CHARTER_CAPACITY_MESSAGE =
  'This charter only has {remaining} passenger spot(s) remaining for the selected time.';

function intervalsOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  return aStartMs < bEndMs && aEndMs > bStartMs;
}

function bookingRowBlocksSlot(row) {
  if (!row || !BLOCKING_BOOKING_STATUSES.has(String(row.status || ''))) {
    return false;
  }
  const exp = row.expires_at ? new Date(String(row.expires_at)).getTime() : NaN;
  if (String(row.status) === 'pending' && Number.isFinite(exp) && exp < Date.now()) {
    return false;
  }
  const holdExp = row.hold_expires_at ? new Date(String(row.hold_expires_at)).getTime() : NaN;
  if (String(row.status) === 'hold' && Number.isFinite(holdExp) && holdExp < Date.now()) {
    return false;
  }
  return true;
}

function normalizeCharterSeating(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'shared' || v === 'private') return v;
  return null;
}

/** Staff captain-led bookings use shared seating on the assigned vessel. */
function staffBookingTypeUsesSharedSeating(bookingType) {
  return String(bookingType || '').trim().toLowerCase() === 'captain_charter';
}

/**
 * Bioluminescence is always shared seating. Client `private` / mis-tagged rows
 * must not exclusive-lock the boat — remaining seats stay bookable.
 */
function isBioluminescenceCharter({
  charterType = null,
  charter_type = null,
  pricingPackageId = null,
  pricing_package_id = null,
  bioPackage = null,
} = {}) {
  if (bioPackage) return true;
  const type = String(charterType || charter_type || '').trim().toLowerCase();
  if (type === 'bio' || type === 'night_bio') return true;
  const pkg = String(
    pricingPackageId || pricing_package_id || (bioPackage && bioPackage.id) || ''
  ).trim();
  return pkg.startsWith('bio_');
}

function isSharedCharterBooking(row) {
  if (!row || String(row.booking_type || '') !== 'charter') return false;
  if (isBioluminescenceCharter(row)) return true;
  const seating = normalizeCharterSeating(row.charter_seating);
  if (seating === 'shared') return true;
  if (seating === 'private') return false;
  const charterType = String(row.charter_type || '').trim().toLowerCase();
  if (charterType === 'rocket' || charterType === 'rocket_launch') {
    const packageId = String(row.pricing_package_id || '').trim();
    if (packageId === 'rocket_private') return false;
    return true;
  }
  return charterType === 'captain_charter' && row.boat_id != null;
}

function isExclusiveBoatBooking(row) {
  if (!bookingRowBlocksSlot(row)) return false;
  if (String(row.booking_type || '') === 'rental') return true;
  if (String(row.booking_type || '') === 'charter') {
    return !isSharedCharterBooking(row);
  }
  return true;
}

function effectiveGuestCountForCapacity(row) {
  const packageId = String(row?.pricing_package_id || '').trim();
  if (packageId && packageId.startsWith('rocket_')) {
    try {
      const { getRocketLaunchPackage, getCapacityReservedForPackage } = require('../config/rocketLaunchPackages');
      if (getRocketLaunchPackage && getCapacityReservedForPackage) {
        const pkg = getRocketLaunchPackage(packageId);
        const reserved = getCapacityReservedForPackage(pkg);
        if (reserved) return reserved;
      }
    } catch {
      // fall through
    }
  }
  if (packageId && packageId.startsWith('sunset_')) {
    try {
      const {
        getSunsetPackage,
        getCapacityReservedForSunsetPackage,
      } = require('../config/sunsetPackages');
      if (getSunsetPackage && getCapacityReservedForSunsetPackage) {
        const pkg = getSunsetPackage(packageId);
        const reserved = getCapacityReservedForSunsetPackage(pkg);
        if (reserved) return reserved;
      }
    } catch {
      // fall through
    }
  }
  const validated = validateCharterPassengerCount(row?.guest_count);
  if (validated.valid) return validated.count;
  return UNKNOWN_GUEST_COUNT_ASSUMES;
}

function formatCapacityMessage(remaining) {
  const n = Math.max(0, Math.floor(Number(remaining) || 0));
  return SHARED_CHARTER_CAPACITY_MESSAGE.replace('{remaining}', String(n));
}

/**
 * @param {object} params
 * @param {Array} params.overlappingBookings - rows already filtered to time range + boat
 * @param {number} params.proposedGuestCount
 * @param {string|null} params.excludeBookingId
 */
function evaluateSharedCharterCapacity({
  overlappingBookings,
  proposedGuestCount,
  excludeBookingId = null,
}) {
  const proposedValidation = validateCharterPassengerCount(proposedGuestCount);
  if (!proposedValidation.valid) {
    return {
      available: false,
      reason: 'invalid_passenger_count',
      message: proposedValidation.error,
      capacity: null,
      conflict: null,
    };
  }
  const proposed = proposedValidation.count;

  const active = (overlappingBookings || []).filter((row) => {
    if (excludeBookingId && String(row.id) === String(excludeBookingId)) return false;
    return bookingRowBlocksSlot(row);
  });

  const exclusive = active.find((row) => isExclusiveBoatBooking(row));
  if (exclusive) {
    return {
      available: false,
      reason: 'exclusive_conflict',
      message: 'This boat already has an exclusive booking during that time.',
      capacity: { max: CHARTER_MAX_PASSENGERS, used: CHARTER_MAX_PASSENGERS, remaining: 0, requested: proposed },
      conflict: exclusive,
    };
  }

  const sharedRows = active.filter((row) => isSharedCharterBooking(row));
  const used = sharedRows.reduce((sum, row) => sum + effectiveGuestCountForCapacity(row), 0);
  const remainingBefore = Math.max(0, CHARTER_MAX_PASSENGERS - used);
  const remainingAfter = CHARTER_MAX_PASSENGERS - used - proposed;

  if (remainingAfter < 0) {
    return {
      available: false,
      reason: 'charter_capacity',
      message: formatCapacityMessage(remainingBefore),
      capacity: {
        max: CHARTER_MAX_PASSENGERS,
        used,
        remaining: remainingBefore,
        requested: proposed,
      },
      conflict: sharedRows[0] || null,
    };
  }

  return {
    available: true,
    reason: null,
    message: null,
    capacity: {
      max: CHARTER_MAX_PASSENGERS,
      used,
      remaining: remainingAfter,
      requested: proposed,
    },
    conflict: null,
  };
}

module.exports = {
  BLOCKING_BOOKING_STATUSES,
  CHARTER_MAX_PASSENGERS,
  SHARED_CHARTER_CAPACITY_MESSAGE,
  bookingRowBlocksSlot,
  effectiveGuestCountForCapacity,
  evaluateSharedCharterCapacity,
  formatCapacityMessage,
  intervalsOverlap,
  isBioluminescenceCharter,
  isExclusiveBoatBooking,
  isSharedCharterBooking,
  normalizeCharterSeating,
  staffBookingTypeUsesSharedSeating,
  UNKNOWN_GUEST_COUNT_ASSUMES,
};
