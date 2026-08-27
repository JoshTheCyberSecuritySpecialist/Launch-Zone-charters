/**
 * Sunset shared departures:
 * - sunset_two and sunset_three may open a shared departure (immediately confirmed).
 * - sunset_solo may only join a paid, open shared sunset departure.
 * Unpaid checkout holds do not count as joinable.
 */
const { CHARTER_MAX_PASSENGERS } = require('../charterCapacity');
const {
  getCapacityReservedForSunsetPackage,
  isSunsetPackageId,
} = require('../config/sunsetPackages');
const {
  bookingRowBlocksSlot,
  effectiveGuestCountForCapacity,
} = require('../lib/sharedCharterCapacity');

const DEPARTURE_STATUS = Object.freeze({
  AWAITING_MINIMUM: 'awaiting_minimum',
  DEPARTURE_CONFIRMED: 'departure_confirmed',
  DEPARTURE_FULL: 'departure_full',
});

const PAID_SHARED_STATUSES = new Set([
  'pending_verification',
  'confirmed',
  'ready_for_departure',
  'completed',
]);

const PAID_PAYMENT_STATUSES = new Set(['paid', 'deposit_paid']);

const SOLO_NO_DEPARTURE_MESSAGE =
  'No shared sunset departure is open for this time yet. You can choose another shared departure, book Sunset for Two or Three, or book a private sunset experience.';

function normalizeSunsetCharterType(charterType) {
  const t = String(charterType || '').trim().toLowerCase();
  if (t === 'sunset' || t === 'sunset_cruise') return 'sunset';
  return t;
}

function isSunsetSharedCharterRow(row) {
  if (!row || String(row.booking_type || '') !== 'charter') return false;
  if (normalizeSunsetCharterType(row.charter_type) !== 'sunset') return false;
  return String(row.charter_seating || '').trim().toLowerCase() === 'shared';
}

function isPaidCommittedSharedSunsetRow(row) {
  if (!isSunsetSharedCharterRow(row)) return false;
  if (!PAID_SHARED_STATUSES.has(String(row.status || ''))) return false;
  const pay = String(row.payment_status || '').trim().toLowerCase();
  return PAID_PAYMENT_STATUSES.has(pay);
}

function capacitySeatsForRow(row) {
  const packageId = String(row?.pricing_package_id || '').trim();
  if (packageId && isSunsetPackageId(packageId)) {
    const { getSunsetPackage } = require('../config/sunsetPackages');
    try {
      const reserved = getCapacityReservedForSunsetPackage(getSunsetPackage(packageId));
      if (reserved) return reserved;
    } catch {
      // fall through
    }
  }
  return effectiveGuestCountForCapacity(row);
}

function sumSharedGuestTotal(rows, { excludeBookingId = null, additionalGuests = 0, paidOnly = false } = {}) {
  let total = Math.max(0, Math.floor(Number(additionalGuests) || 0));
  for (const row of rows || []) {
    if (excludeBookingId && String(row.id) === String(excludeBookingId)) continue;
    if (!isSunsetSharedCharterRow(row)) continue;
    if (paidOnly) {
      if (!isPaidCommittedSharedSunsetRow(row)) continue;
    } else if (!bookingRowBlocksSlot(row)) {
      continue;
    }
    total += capacitySeatsForRow(row);
  }
  return total;
}

async function loadSunsetSharedRows(
  supabase,
  { boatId, startTime, sharedDepartureId = null, paidOnly = false } = {}
) {
  if (!supabase) return [];
  const selectCols =
    'id, status, payment_status, booking_type, charter_type, charter_seating, guest_count, pricing_package_id, package_guest_count, start_time, end_time, expires_at, shared_departure_id, departure_confirmation_status';

  if (sharedDepartureId) {
    const { data, error } = await supabase.from('bookings').select(selectCols).eq('shared_departure_id', sharedDepartureId);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return paidOnly ? rows.filter(isPaidCommittedSharedSunsetRow) : rows.filter(bookingRowBlocksSlot);
  }

  const startIso = new Date(String(startTime || '')).toISOString();
  const boat = String(boatId || '').trim();
  if (!boat || !Number.isFinite(new Date(startIso).getTime())) return [];

  const { data, error } = await supabase
    .from('bookings')
    .select(selectCols)
    .eq('boat_id', boat)
    .eq('start_time', startIso)
    .eq('charter_type', 'sunset')
    .eq('charter_seating', 'shared');
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return paidOnly ? rows.filter(isPaidCommittedSharedSunsetRow) : rows.filter(bookingRowBlocksSlot);
}

async function loadPaidSharedSunsetRowsForDay(supabase, { boatId, rangeStartIso, rangeEndIso }) {
  if (!supabase) return [];
  const boat = String(boatId || '').trim();
  if (!boat) return [];
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, status, payment_status, booking_type, charter_type, charter_seating, guest_count, pricing_package_id, package_guest_count, start_time, end_time, expires_at, shared_departure_id, boat_id'
    )
    .eq('boat_id', boat)
    .eq('charter_type', 'sunset')
    .eq('charter_seating', 'shared')
    .gte('start_time', rangeStartIso)
    .lt('start_time', rangeEndIso)
    .in('status', Array.from(PAID_SHARED_STATUSES));
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter(isPaidCommittedSharedSunsetRow);
}

function groupJoinableSunsetStarts(rows, passengerCount = 1) {
  const requested = Math.max(1, Math.floor(Number(passengerCount) || 1));
  const byStart = new Map();
  for (const row of rows || []) {
    if (!isPaidCommittedSharedSunsetRow(row)) continue;
    const startIso = String(row.start_time || '');
    if (!startIso) continue;
    if (!byStart.has(startIso)) byStart.set(startIso, []);
    byStart.get(startIso).push(row);
  }
  const joinable = [];
  for (const [startIso, group] of byStart.entries()) {
    const used = sumSharedGuestTotal(group, { paidOnly: true });
    const remaining = Math.max(0, CHARTER_MAX_PASSENGERS - used);
    if (used <= 0 || remaining < requested) continue;
    const sharedDepartureId = group.find((row) => row.shared_departure_id)?.shared_departure_id || null;
    joinable.push({
      startIso,
      guestsBooked: used,
      guestsMax: CHARTER_MAX_PASSENGERS,
      seatsRemaining: remaining,
      sharedDepartureId,
    });
  }
  return joinable;
}

async function listJoinableSunsetSoloSlots(supabase, { boatId, rangeStartIso, rangeEndIso, passengerCount = 1 }) {
  const rows = await loadPaidSharedSunsetRowsForDay(supabase, { boatId, rangeStartIso, rangeEndIso });
  return groupJoinableSunsetStarts(rows, passengerCount);
}

async function assertSunsetSoloCanJoin(supabase, { boatId, startTime, passengerCount = 1, excludeBookingId = null }) {
  const rows = await loadSunsetSharedRows(supabase, { boatId, startTime, paidOnly: true });
  const filtered = (rows || []).filter((row) => !excludeBookingId || String(row.id) !== String(excludeBookingId));
  if (filtered.length === 0) {
    const err = new Error(SOLO_NO_DEPARTURE_MESSAGE);
    err.statusCode = 409;
    err.code = 'sunset_solo_no_open_departure';
    throw err;
  }
  const used = sumSharedGuestTotal(filtered, { paidOnly: true });
  const remaining = Math.max(0, CHARTER_MAX_PASSENGERS - used);
  const requested = Math.max(1, Math.floor(Number(passengerCount) || 1));
  if (remaining < requested) {
    const err = new Error('This shared sunset departure is now full. Please choose another available time.');
    err.statusCode = 409;
    err.code = 'charter_capacity';
    throw err;
  }
  const sharedDepartureId = filtered.find((row) => row.shared_departure_id)?.shared_departure_id || null;
  return {
    sharedDepartureId,
    guestsBooked: used,
    seatsRemaining: remaining,
  };
}

async function resolveSunsetSharedDepartureId(supabase, { boatId, startTime }) {
  const rows = await loadSunsetSharedRows(supabase, { boatId, startTime });
  const existing = rows.find((row) => row.shared_departure_id);
  if (existing?.shared_departure_id) return String(existing.shared_departure_id);
  const { randomUUID } = require('crypto');
  return randomUUID();
}

async function buildSunsetDepartureInsertFields(
  supabase,
  { sunsetPackage, charterType, charterSeating, boatId, startTime, passengerCount, excludeBookingId = null }
) {
  if (!sunsetPackage || normalizeSunsetCharterType(charterType) !== 'sunset') {
    return { shared_departure_id: null, departure_confirmation_status: null };
  }

  if (String(sunsetPackage.seating || '').trim().toLowerCase() === 'private') {
    return {
      shared_departure_id: null,
      departure_confirmation_status: DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
    };
  }

  if (String(charterSeating || '').trim().toLowerCase() !== 'shared') {
    return { shared_departure_id: null, departure_confirmation_status: null };
  }

  const reserved =
    getCapacityReservedForSunsetPackage(sunsetPackage) ||
    Math.max(1, Math.floor(Number(passengerCount) || 1));

  if (sunsetPackage.id === 'sunset_solo' || sunsetPackage.canOpenSharedDeparture === false) {
    const join = await assertSunsetSoloCanJoin(supabase, {
      boatId,
      startTime,
      passengerCount: reserved,
      excludeBookingId,
    });
    let sharedDepartureId = join.sharedDepartureId;
    if (!sharedDepartureId) {
      sharedDepartureId = await resolveSunsetSharedDepartureId(supabase, { boatId, startTime });
    }
    const totalAfter = join.guestsBooked + reserved;
    return {
      shared_departure_id: sharedDepartureId,
      departure_confirmation_status:
        totalAfter >= CHARTER_MAX_PASSENGERS
          ? DEPARTURE_STATUS.DEPARTURE_FULL
          : DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
    };
  }

  const sharedDepartureId = await resolveSunsetSharedDepartureId(supabase, { boatId, startTime });
  const rows = await loadSunsetSharedRows(supabase, { boatId, startTime, sharedDepartureId });
  const totalGuests = sumSharedGuestTotal(rows, {
    excludeBookingId,
    additionalGuests: reserved,
  });

  return {
    shared_departure_id: sharedDepartureId,
    departure_confirmation_status:
      totalGuests >= CHARTER_MAX_PASSENGERS
        ? DEPARTURE_STATUS.DEPARTURE_FULL
        : DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
  };
}

module.exports = {
  DEPARTURE_STATUS,
  SOLO_NO_DEPARTURE_MESSAGE,
  PAID_SHARED_STATUSES,
  isPaidCommittedSharedSunsetRow,
  groupJoinableSunsetStarts,
  listJoinableSunsetSoloSlots,
  assertSunsetSoloCanJoin,
  buildSunsetDepartureInsertFields,
  sumSharedGuestTotal,
};
