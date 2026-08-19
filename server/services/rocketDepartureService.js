const crypto = require('crypto');
const { DateTime } = require('luxon');
const { CHARTER_MAX_PASSENGERS } = require('../charterCapacity');
const {
  ROCKET_LAUNCH_MIN_GUESTS,
  isRocketLaunchPackageId,
  getCapacityReservedForPackage,
} = require('../config/rocketLaunchPackages');
const {
  BLOCKING_BOOKING_STATUSES,
  bookingRowBlocksSlot,
  effectiveGuestCountForCapacity,
} = require('../lib/sharedCharterCapacity');

const DEPARTURE_STATUS = Object.freeze({
  AWAITING_MINIMUM: 'awaiting_minimum',
  DEPARTURE_CONFIRMED: 'departure_confirmed',
  DEPARTURE_FULL: 'departure_full',
});

function normalizeRocketCharterType(charterType) {
  const t = String(charterType || '').trim().toLowerCase();
  if (t === 'rocket' || t === 'rocket_launch') return 'rocket';
  return t;
}

function isRocketSharedCharterRow(row) {
  if (!row || String(row.booking_type || '') !== 'charter') return false;
  if (normalizeRocketCharterType(row.charter_type) !== 'rocket') return false;
  return String(row.charter_seating || '').trim().toLowerCase() === 'shared';
}

function isRocketPrivateCharterRow(row) {
  if (!row || String(row.booking_type || '') !== 'charter') return false;
  if (normalizeRocketCharterType(row.charter_type) !== 'rocket') return false;
  return String(row.charter_seating || '').trim().toLowerCase() === 'private';
}

function capacitySeatsForRow(row) {
  if (!row) return 0;
  const packageId = String(row.pricing_package_id || '').trim();
  if (packageId && isRocketLaunchPackageId(packageId)) {
    const { getRocketLaunchPackage } = require('../config/rocketLaunchPackages');
    try {
      const reserved = getCapacityReservedForPackage(getRocketLaunchPackage(packageId));
      if (reserved) return reserved;
    } catch {
      // fall through to guest_count
    }
  }
  return effectiveGuestCountForCapacity(row);
}

function computeDepartureStatusFromGuestTotal(totalGuests) {
  const total = Math.max(0, Math.floor(Number(totalGuests) || 0));
  if (total >= CHARTER_MAX_PASSENGERS) return DEPARTURE_STATUS.DEPARTURE_FULL;
  if (total >= ROCKET_LAUNCH_MIN_GUESTS) return DEPARTURE_STATUS.DEPARTURE_CONFIRMED;
  return DEPARTURE_STATUS.AWAITING_MINIMUM;
}

function buildRocketDepartureSummary(totalGuests) {
  const total = Math.max(0, Math.floor(Number(totalGuests) || 0));
  const minimumGuests = ROCKET_LAUNCH_MIN_GUESTS;
  const maxGuests = CHARTER_MAX_PASSENGERS;
  const guestsNeededForMinimum = Math.max(0, minimumGuests - total);
  return {
    guestsBooked: total,
    guestsMax: maxGuests,
    minimumGuests,
    guestsNeededForMinimum,
    minimumReached: total >= minimumGuests,
    seatsRemaining: Math.max(0, maxGuests - total),
    departureStatus: computeDepartureStatusFromGuestTotal(total),
  };
}

function sumRocketDepartureGuestTotal(rows, { excludeBookingId = null, additionalGuests = 0 } = {}) {
  let total = Math.max(0, Math.floor(Number(additionalGuests) || 0));
  for (const row of rows || []) {
    if (excludeBookingId && String(row.id) === String(excludeBookingId)) continue;
    if (!bookingRowBlocksSlot(row)) continue;
    if (!isRocketSharedCharterRow(row)) continue;
    total += capacitySeatsForRow(row);
  }
  return total;
}

async function loadRocketSharedDepartureRows(supabase, { boatId, startTime, sharedDepartureId = null }) {
  if (!supabase) return [];
  if (sharedDepartureId) {
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, status, booking_type, charter_type, charter_seating, guest_count, pricing_package_id, package_guest_count, start_time, end_time, expires_at, shared_departure_id, departure_confirmation_status'
      )
      .eq('shared_departure_id', sharedDepartureId);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  const startIso = new Date(String(startTime || '')).toISOString();
  const boat = String(boatId || '').trim();
  if (!boat || !Number.isFinite(new Date(startIso).getTime())) return [];

  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, status, booking_type, charter_type, charter_seating, guest_count, pricing_package_id, package_guest_count, start_time, end_time, expires_at, shared_departure_id, departure_confirmation_status'
    )
    .eq('boat_id', boat)
    .eq('start_time', startIso)
    .eq('charter_type', 'rocket')
    .eq('charter_seating', 'shared')
    .in('status', Array.from(BLOCKING_BOOKING_STATUSES));
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter((row) => bookingRowBlocksSlot(row));
}

async function resolveSharedDepartureId(supabase, { boatId, startTime }) {
  const rows = await loadRocketSharedDepartureRows(supabase, { boatId, startTime });
  const existing = rows.find((row) => row.shared_departure_id);
  if (existing?.shared_departure_id) return String(existing.shared_departure_id);
  return crypto.randomUUID();
}

async function buildRocketDepartureInsertFields(
  supabase,
  { rocketPackage, charterType, charterSeating, boatId, startTime, passengerCount, excludeBookingId = null }
) {
  if (!rocketPackage || normalizeRocketCharterType(charterType) !== 'rocket') {
    return { shared_departure_id: null, departure_confirmation_status: null };
  }

  if (String(rocketPackage.seating || '').trim().toLowerCase() === 'private') {
    return {
      shared_departure_id: null,
      departure_confirmation_status: DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
    };
  }

  if (String(charterSeating || '').trim().toLowerCase() !== 'shared') {
    return { shared_departure_id: null, departure_confirmation_status: null };
  }

  const reserved =
    getCapacityReservedForPackage(rocketPackage) ||
    Math.max(1, Math.floor(Number(passengerCount) || 1));
  const sharedDepartureId = await resolveSharedDepartureId(supabase, { boatId, startTime });
  const rows = await loadRocketSharedDepartureRows(supabase, { boatId, startTime, sharedDepartureId });
  const totalGuests = sumRocketDepartureGuestTotal(rows, {
    excludeBookingId,
    additionalGuests: reserved,
  });

  return {
    shared_departure_id: sharedDepartureId,
    departure_confirmation_status: computeDepartureStatusFromGuestTotal(totalGuests),
  };
}

async function refreshRocketDepartureGroup(supabase, sharedDepartureId) {
  const id = String(sharedDepartureId || '').trim();
  if (!supabase || !id) return null;

  const rows = await loadRocketSharedDepartureRows(supabase, { sharedDepartureId: id });
  const sharedRows = rows.filter((row) => isRocketSharedCharterRow(row) && bookingRowBlocksSlot(row));
  if (sharedRows.length === 0) return null;

  const totalGuests = sumRocketDepartureGuestTotal(sharedRows);
  const nextStatus = computeDepartureStatusFromGuestTotal(totalGuests);
  const bookingIds = sharedRows.map((row) => row.id).filter(Boolean);
  const stale = sharedRows.filter((row) => row.departure_confirmation_status !== nextStatus);
  if (stale.length === 0) {
    return { sharedDepartureId: id, totalGuests, departureStatus: nextStatus, updated: 0 };
  }

  const { error } = await supabase
    .from('bookings')
    .update({ departure_confirmation_status: nextStatus })
    .in('id', bookingIds);
  if (error) throw error;

  return { sharedDepartureId: id, totalGuests, departureStatus: nextStatus, updated: stale.length };
}

function enrichCapacityWithRocketDeparture(capacity, { charterType, rocketPackage } = {}) {
  if (!capacity || normalizeRocketCharterType(charterType) !== 'rocket' || !rocketPackage) {
    return capacity;
  }
  if (String(rocketPackage.seating || '').trim().toLowerCase() === 'private') {
    return {
      ...capacity,
      rocketDeparture: {
        ...buildRocketDepartureSummary(0),
        privateCharter: true,
        label: 'Private charter — fully reserved',
      },
    };
  }
  const used = Math.max(0, Number(capacity.used) || 0);
  return {
    ...capacity,
    rocketDeparture: {
      ...buildRocketDepartureSummary(used),
      privateCharter: false,
    },
  };
}

function formatRocketDepartureSlotLabel(summary) {
  if (!summary) return null;
  if (summary.privateCharter) return 'Private charter — fully reserved';
  if (summary.guestsBooked >= summary.guestsMax) return 'Sold out';
  if (summary.minimumReached) {
    return `${summary.guestsBooked} of ${summary.guestsMax} seats · Minimum reached · ${summary.seatsRemaining} remaining`;
  }
  return `${summary.guestsBooked} of ${summary.guestsMax} seats · ${summary.guestsNeededForMinimum} more guest${summary.guestsNeededForMinimum === 1 ? '' : 's'} needed`;
}

function mapGroupBookingRow(row) {
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
  return {
    id: row.id,
    status: row.status,
    guestCount: capacitySeatsForRow(row),
    packageName: row.pricing_package_name || null,
    customerName: customer?.full_name || null,
    customerEmail: customer?.email || null,
    departureConfirmationStatus: row.departure_confirmation_status || null,
  };
}

async function getRocketDepartureAdminDetail(supabase, bookingId) {
  const id = String(bookingId || '').trim();
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      'id, booking_type, charter_type, charter_seating, pricing_package_id, pricing_package_name, shared_departure_id, departure_confirmation_status, start_time, guest_count, package_guest_count, status'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) {
    const err = new Error('Booking not found');
    err.statusCode = 404;
    throw err;
  }

  if (isRocketPrivateCharterRow(booking)) {
    return {
      applicable: true,
      privateCharter: true,
      departureStatus: booking.departure_confirmation_status || DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
      summary: { ...buildRocketDepartureSummary(0), privateCharter: true },
      label: 'Private rocket charter — no shared minimum',
      canForceConfirm: false,
      canRevertToComputed: false,
      bookings: [],
    };
  }

  if (!isRocketSharedCharterRow(booking)) {
    return { applicable: false };
  }

  if (!booking.shared_departure_id) {
    return {
      applicable: true,
      privateCharter: false,
      legacyBooking: true,
      departureStatus: booking.departure_confirmation_status || null,
      summary: buildRocketDepartureSummary(capacitySeatsForRow(booking)),
      label: 'Legacy rocket booking — no departure group assigned',
      canForceConfirm: false,
      canRevertToComputed: false,
      bookings: [mapGroupBookingRow(booking)],
    };
  }

  const sharedDepartureId = String(booking.shared_departure_id);
  const { data: groupRows, error: groupErr } = await supabase
    .from('bookings')
    .select(
      'id, status, guest_count, package_guest_count, pricing_package_id, pricing_package_name, departure_confirmation_status, customers(full_name, email)'
    )
    .eq('shared_departure_id', sharedDepartureId)
    .order('created_at', { ascending: true });
  if (groupErr) throw groupErr;

  const rows = Array.isArray(groupRows) ? groupRows : [];
  const activeRows = rows.filter((row) => bookingRowBlocksSlot(row) && isRocketSharedCharterRow(row));
  const totalGuests = sumRocketDepartureGuestTotal(activeRows);
  const summary = buildRocketDepartureSummary(totalGuests);
  const computedStatus = summary.departureStatus;
  const currentStatus = String(activeRows[0]?.departure_confirmation_status || booking.departure_confirmation_status || computedStatus);
  const staffOverridden =
    currentStatus === DEPARTURE_STATUS.DEPARTURE_CONFIRMED &&
    computedStatus === DEPARTURE_STATUS.AWAITING_MINIMUM;

  return {
    applicable: true,
    privateCharter: false,
    sharedDepartureId,
    departureStatus: currentStatus,
    computedStatus,
    staffOverridden,
    summary,
    label: formatRocketDepartureSlotLabel({ ...summary, privateCharter: false }),
    canForceConfirm: computedStatus === DEPARTURE_STATUS.AWAITING_MINIMUM,
    canRevertToComputed: currentStatus !== computedStatus,
    bookings: rows.map(mapGroupBookingRow),
  };
}

async function applyStaffRocketDepartureOverride(supabase, { bookingId, action, reason }) {
  const reasonSafe = String(reason || '').trim();
  if (reasonSafe.length < 8) {
    const err = new Error('Override reason must be at least 8 characters.');
    err.statusCode = 400;
    throw err;
  }

  const detail = await getRocketDepartureAdminDetail(supabase, bookingId);
  if (!detail.applicable || detail.privateCharter || detail.legacyBooking) {
    const err = new Error('Rocket departure override does not apply to this booking.');
    err.statusCode = 400;
    throw err;
  }

  const sharedDepartureId = detail.sharedDepartureId;
  const actionSafe = String(action || '').trim().toLowerCase();

  if (actionSafe === 'force_confirm') {
    const rows = await loadRocketSharedDepartureRows(supabase, { sharedDepartureId });
    const bookingIds = rows.filter((row) => isRocketSharedCharterRow(row) && bookingRowBlocksSlot(row)).map((row) => row.id);
    if (bookingIds.length === 0) {
      const err = new Error('No active shared rocket bookings found for this departure.');
      err.statusCode = 400;
      throw err;
    }
    const { error } = await supabase
      .from('bookings')
      .update({ departure_confirmation_status: DEPARTURE_STATUS.DEPARTURE_CONFIRMED })
      .in('id', bookingIds);
    if (error) throw error;
    return {
      action: actionSafe,
      sharedDepartureId,
      departureStatus: DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
      updated: bookingIds.length,
      reason: reasonSafe,
    };
  }

  if (actionSafe === 'revert_to_computed') {
    const result = await refreshRocketDepartureGroup(supabase, sharedDepartureId);
    return {
      action: actionSafe,
      sharedDepartureId,
      reason: reasonSafe,
      ...(result || {}),
    };
  }

  const err = new Error('action must be force_confirm or revert_to_computed');
  err.statusCode = 400;
  throw err;
}

module.exports = {
  DEPARTURE_STATUS,
  ROCKET_LAUNCH_MIN_GUESTS,
  normalizeRocketCharterType,
  isRocketSharedCharterRow,
  isRocketPrivateCharterRow,
  capacitySeatsForRow,
  computeDepartureStatusFromGuestTotal,
  buildRocketDepartureSummary,
  sumRocketDepartureGuestTotal,
  resolveSharedDepartureId,
  buildRocketDepartureInsertFields,
  refreshRocketDepartureGroup,
  enrichCapacityWithRocketDeparture,
  formatRocketDepartureSlotLabel,
  getRocketDepartureAdminDetail,
  applyStaffRocketDepartureOverride,
};
