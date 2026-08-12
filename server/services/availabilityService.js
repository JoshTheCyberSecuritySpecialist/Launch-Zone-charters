/**
 * Server-side availability for calendar / time-slot UI.
 * Uses same overlap semantics as bookings assertSlotAvailable + blocked_dates.
 */
const { DateTime } = require('luxon');
const supabase = require('../supabaseClient');
const {
  CAPTAIN_NIGHT_END_HOUR,
  CAPTAIN_NIGHT_START_HOUR,
  CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE,
  CAPTAIN_NIGHT_WEEKDAYS,
  captainNightUnavailableMessage,
  getCaptainNightAnchorDay,
} = require('../lib/captainNightSchedule');
const {
  evaluateSharedCharterCapacity,
  formatCapacityMessage,
  normalizeCharterSeating,
} = require('../lib/sharedCharterCapacity');
const boatCapacityService = require('./boatCapacityService');

const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();
const DEFAULT_OPEN_HOUR = Number(process.env.AVAILABILITY_OPEN_HOUR || 7);
const DEFAULT_CLOSE_HOUR = Number(process.env.AVAILABILITY_CLOSE_HOUR || 20);
const DEFAULT_STEP_MINUTES = Number(process.env.AVAILABILITY_SLOT_MINUTES || 30);
const DEFAULT_RANGE_DAYS = Number(process.env.AVAILABILITY_CALENDAR_DAYS || 60);
const MIN_LEAD_HOURS = Math.max(0, Number(process.env.BOOKING_MIN_LEAD_HOURS || 2));
const CHARTER_DURATION_HOURS = 1;
const CHARTER_END_TOO_LATE_MESSAGE = 'Bookings must finish by 4:00 AM.';
const BIO_CHARTER_START_HOURS = new Set([20, 21, 22, 23, 0, 1, 2, 3, 4]);
const DEFAULT_CHARTER_START_HOURS = new Set([17, 18, 19, 20, 21]);
const BIO_CHARTER_TIME_MESSAGE =
  'Bioluminescence night tours are available from 8:00 PM through 4:00 AM.';
const NON_BIO_LATE_NIGHT_MESSAGE =
  'Late-night times are only available for bioluminescence night tours.';

const SLOT_TAKEN_USER_MESSAGE =
  'This departure is no longer available. Another reservation was made for this time. Please select another time.';
const SLOT_TOO_SOON_USER_MESSAGE =
  'This departure is too soon. Please choose a later time or call us for help.';
const DEPARTURE_FULL_MESSAGE =
  'This departure is now full. Please select another available time.';

const BLOCKING_BOOKING_STATUSES = new Set([
  'hold',
  'pending',
  'pending_verification',
  'confirmed',
  'ready_for_departure',
  'completed',
]);

function normalizeSlotRows(slots) {
  return (slots || []).map((slot) => ({
    startIso: slot.startIso || slot.start,
    endIso: slot.endIso || slot.end,
    label: slot.label,
    startHHMM: slot.startHHMM,
    available: slot.available !== false,
  }));
}

function rentalTripTypeForLocation(location) {
  const loc = String(location || 'port-orange').trim().toLowerCase();
  return loc === 'titusville' ? 'center_console_rental' : 'pontoon_rental';
}

async function resolveRentalBoatForLocation(location) {
  const tripType = rentalTripTypeForLocation(location);
  return boatCapacityService.resolveBoatIdForTripType(supabase, tripType);
}

async function listRentalSlotsForLocation(location, dateStr, durationHours, openHour, closeHour, stepMinutes) {
  const boatId = await resolveRentalBoatForLocation(location);
  if (!boatId) {
    return { boatId: null, location: location || 'port-orange', slots: [] };
  }
  const rawSlots = await listSlotsForDay(boatId, dateStr, durationHours, openHour, closeHour, stepMinutes);
  return {
    boatId,
    location: location || 'port-orange',
    slots: normalizeSlotRows(rawSlots),
  };
}

function leadTimeUnavailableResult(location = null) {
  return {
    available: false,
    reason: 'lead_time',
    conflict: null,
    message: SLOT_TOO_SOON_USER_MESSAGE,
    location,
  };
}

function bookingRowBlocksSlot(row) {
  if (!row || !BLOCKING_BOOKING_STATUSES.has(String(row.status || ''))) {
    return false;
  }
  const exp = row.expires_at ? new Date(String(row.expires_at)).getTime() : NaN;
  if (String(row.status) === 'pending' && Number.isFinite(exp) && exp < Date.now()) {
    return false;
  }
  return true;
}

function intervalsOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  return aStartMs < bEndMs && aEndMs > bStartMs;
}

async function fetchBlockingBookings(boatId, rangeStartIso, rangeEndIso) {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, start_time, end_time, status, expires_at, customer_id, boat_id, booking_type, charter_type, charter_seating, guest_count, customers(full_name, email, phone), boats(name)'
    )
    .eq('boat_id', String(boatId))
    .lt('start_time', rangeEndIso)
    .gt('end_time', rangeStartIso);
  if (error) throw new Error(error.message || 'Could not load bookings');
  return (data || []).filter(bookingRowBlocksSlot);
}

async function fetchBlockingCharters(rangeStartIso, rangeEndIso) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, start_time, end_time, status, expires_at, customer_id, booking_type, charter_type, customers(full_name, email, phone)')
    .eq('booking_type', 'charter')
    .lt('start_time', rangeEndIso)
    .gt('end_time', rangeStartIso);
  if (error) throw new Error(error.message || 'Could not load charter bookings');
  return (data || []).filter(bookingRowBlocksSlot);
}

async function fetchBlockedDateRanges(boatId, rangeStartIso, rangeEndIso) {
  const boat = String(boatId);
  const { data, error } = await supabase
    .from('blocked_dates')
    .select('start_time, end_time, boat_id, block_scope')
    .lt('start_time', rangeEndIso)
    .gt('end_time', rangeStartIso)
    .or(`boat_id.eq.${boat},boat_id.is.null`);
  if (!error) {
    return (data || []).filter((row) => String(row.block_scope || 'all') !== 'charter');
  }

  // Backward compatibility: some DBs use date-only columns (start_date/end_date).
  // Try fallback regardless of exact PostgREST wording for missing/invalid columns.

  const rangeStartDate = rangeStartIso.slice(0, 10);
  const rangeEndDateExclusive = rangeEndIso.slice(0, 10);
  const { data: dateRows, error: dateErr } = await supabase
    .from('blocked_dates')
    .select('start_date, end_date, boat_id')
    .lt('start_date', rangeEndDateExclusive)
    .gte('end_date', rangeStartDate)
    .or(`boat_id.eq.${boat},boat_id.is.null`);
  if (dateErr) {
    throw new Error(
      `${error.message || 'Could not load blocked dates'}; fallback failed: ${dateErr.message || 'unknown'}`
    );
  }

  return (dateRows || []).map((r) => {
    const start = DateTime.fromISO(String(r.start_date), { zone: BUSINESS_TZ }).startOf('day');
    const endInclusive = DateTime.fromISO(String(r.end_date), { zone: BUSINESS_TZ }).startOf('day');
    return {
      boat_id: r.boat_id ?? null,
      start_time: start.toUTC().toISO(),
      // date ranges are typically inclusive, so make the blocking interval end exclusive at next day.
      end_time: endInclusive.plus({ days: 1 }).toUTC().toISO(),
    };
  });
}

async function fetchFleetBlockedDateRanges(rangeStartIso, rangeEndIso) {
  const { data, error } = await supabase
    .from('blocked_dates')
    .select('start_time, end_time, boat_id, block_scope')
    .is('boat_id', null)
    .lt('start_time', rangeEndIso)
    .gt('end_time', rangeStartIso);
  if (!error) {
    return (data || []).filter((row) => {
      const scope = String(row.block_scope || 'all');
      return scope === 'all' || scope === 'charter';
    });
  }

  const rangeStartDate = rangeStartIso.slice(0, 10);
  const rangeEndDateExclusive = rangeEndIso.slice(0, 10);
  const { data: dateRows, error: dateErr } = await supabase
    .from('blocked_dates')
    .select('start_date, end_date, boat_id')
    .is('boat_id', null)
    .lt('start_date', rangeEndDateExclusive)
    .gte('end_date', rangeStartDate);
  if (dateErr) {
    throw new Error(
      `${error.message || 'Could not load blocked dates'}; fallback failed: ${dateErr.message || 'unknown'}`
    );
  }

  return (dateRows || []).map((r) => {
    const start = DateTime.fromISO(String(r.start_date), { zone: BUSINESS_TZ }).startOf('day');
    const endInclusive = DateTime.fromISO(String(r.end_date), { zone: BUSINESS_TZ }).startOf('day');
    return {
      boat_id: null,
      start_time: start.toUTC().toISO(),
      end_time: endInclusive.plus({ days: 1 }).toUTC().toISO(),
    };
  });
}

async function fetchFleetAdminBlockingItemRanges(rangeStartIso, rangeEndIso) {
  const { data, error } = await supabase
    .from('admin_calendar_items')
    .select('id, boat_id, start_time, end_time, title, item_type, blocks_availability')
    .eq('blocks_availability', true)
    .is('boat_id', null)
    .lt('start_time', rangeEndIso)
    .gt('end_time', rangeStartIso);
  if (error) {
    if (/admin_calendar_items|schema cache|does not exist/i.test(String(error.message || ''))) return [];
    throw new Error(error.message || 'Could not load admin calendar blocks');
  }
  return data || [];
}

async function fetchAdminBlockingItemRanges(boatId, rangeStartIso, rangeEndIso) {
  const boat = String(boatId);
  const { data, error } = await supabase
    .from('admin_calendar_items')
    .select('id, boat_id, start_time, end_time, title, item_type, blocks_availability')
    .eq('blocks_availability', true)
    .lt('start_time', rangeEndIso)
    .gt('end_time', rangeStartIso)
    .or(`boat_id.eq.${boat},boat_id.is.null`);
  if (error) {
    // Backward compatibility while the migration is not yet applied.
    if (/admin_calendar_items|schema cache|does not exist/i.test(String(error.message || ''))) return [];
    throw new Error(error.message || 'Could not load admin calendar blocks');
  }
  return data || [];
}

function toIntervals(rows, keyStart, keyEnd) {
  return (rows || []).map((r) => ({
    startMs: new Date(String(r[keyStart])).getTime(),
    endMs: new Date(String(r[keyEnd])).getTime(),
  }));
}

function slotConflicts(startMs, endMs, intervals) {
  return intervals.some((iv) => intervalsOverlap(startMs, endMs, iv.startMs, iv.endMs));
}

function parseSlotRange(startIso, endIso) {
  const start = new Date(String(startIso || ''));
  const end = new Date(String(endIso || ''));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    const err = new Error('Invalid start or end time.');
    err.statusCode = 400;
    throw err;
  }
  if (end.getTime() <= start.getTime()) {
    const err = new Error('End time must be after start time.');
    err.statusCode = 400;
    throw err;
  }
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

async function checkSharedCharterSlotAvailability({
  boatId,
  startTime,
  endTime,
  passengerCount = 1,
  location = null,
  excludeBookingId = null,
} = {}) {
  const boat = String(boatId || '').trim();
  if (!boat) {
    const err = new Error('Boat id required for availability check');
    err.statusCode = 400;
    throw err;
  }

  const slot = parseSlotRange(startTime, endTime);
  const [bookings, blockedDates, adminBlocks] = await Promise.all([
    fetchBlockingBookings(boat, slot.startIso, slot.endIso),
    fetchBlockedDateRanges(boat, slot.startIso, slot.endIso),
    fetchAdminBlockingItemRanges(boat, slot.startIso, slot.endIso),
  ]);

  const capacityResult = evaluateSharedCharterCapacity({
    overlappingBookings: bookings,
    proposedGuestCount: passengerCount,
    excludeBookingId,
  });

  if (!capacityResult.available) {
    return {
      available: false,
      reason: capacityResult.reason,
      message: capacityResult.message,
      conflict: capacityResult.conflict,
      capacity: capacityResult.capacity,
      location,
    };
  }

  const blockedIntervals = toIntervals(blockedDates, 'start_time', 'end_time').concat(
    toIntervals(adminBlocks, 'start_time', 'end_time')
  );
  if (slotConflicts(slot.startMs, slot.endMs, blockedIntervals)) {
    return {
      available: false,
      reason: 'blocked_date',
      conflict: null,
      message: null,
      capacity: capacityResult.capacity,
      location,
    };
  }

  return {
    available: true,
    reason: null,
    conflict: null,
    message: null,
    capacity: capacityResult.capacity,
    location,
  };
}

async function assertSharedCharterSlotAvailable(input) {
  const result = await checkSharedCharterSlotAvailability(input);
  if (result.available) return result;

  const err = new Error(result.message || SLOT_TAKEN_USER_MESSAGE);
  err.statusCode = result.reason === 'invalid_passenger_count' ? 400 : 409;
  err.code = result.reason || 'slot_unavailable';
  err.availability = result;
  throw err;
}

async function checkStaffBookingAvailability({
  boatId,
  startTime,
  endTime,
  bookingType = 'rental',
  location = null,
  excludeBookingId = null,
  passengerCount = 1,
} = {}) {
  if (String(bookingType || '').trim().toLowerCase() === 'captain_charter') {
    const windowCheck = validateCharterSlotWindow({
      charterType: 'captain_charter',
      startIso: startTime,
      endIso: endTime,
    });
    if (!windowCheck.valid) {
      return {
        available: false,
        reason: 'captain_window',
        message: windowCheck.message || CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE,
        conflict: null,
        capacity: null,
        location,
      };
    }

    return checkSharedCharterSlotAvailability({
      boatId,
      startTime,
      endTime,
      passengerCount,
      location,
      excludeBookingId,
    });
  }

  return checkBookingSlotAvailability({
    boatId,
    startTime,
    endTime,
    location,
    excludeBookingId,
  });
}

async function checkBookingSlotAvailability({
  boatId,
  startTime,
  endTime,
  location = null,
  excludeBookingId = null,
} = {}) {
  const boat = String(boatId || '').trim();
  if (!boat) {
    const err = new Error('Boat id required for availability check');
    err.statusCode = 400;
    throw err;
  }

  const slot = parseSlotRange(startTime, endTime);
  if (!isStartTimeAllowed(slot.startIso)) {
    return leadTimeUnavailableResult(location);
  }
  const [bookings, blockedDates, adminBlocks] = await Promise.all([
    fetchBlockingBookings(boat, slot.startIso, slot.endIso),
    fetchBlockedDateRanges(boat, slot.startIso, slot.endIso),
    fetchAdminBlockingItemRanges(boat, slot.startIso, slot.endIso),
  ]);

  const bookingConflict = bookings.find((row) => {
    if (excludeBookingId && String(row.id) === String(excludeBookingId)) return false;
    return intervalsOverlap(
      slot.startMs,
      slot.endMs,
      new Date(String(row.start_time)).getTime(),
      new Date(String(row.end_time)).getTime()
    );
  });

  if (bookingConflict) {
    return {
      available: false,
      reason: 'booking_conflict',
      conflict: bookingConflict,
      location,
    };
  }

  const blockedIntervals = toIntervals(blockedDates, 'start_time', 'end_time').concat(
    toIntervals(adminBlocks, 'start_time', 'end_time')
  );
  if (slotConflicts(slot.startMs, slot.endMs, blockedIntervals)) {
    return {
      available: false,
      reason: 'blocked_date',
      conflict: null,
      location,
    };
  }

  return {
    available: true,
    reason: null,
    conflict: null,
    location,
  };
}

async function assertBookingSlotAvailable(input) {
  const result = await checkBookingSlotAvailability(input);
  if (result.available) return result;

  const err = new Error(result.message || SLOT_TAKEN_USER_MESSAGE);
  err.statusCode = result.reason === 'lead_time' ? 409 : 409;
  err.code = result.reason || 'slot_unavailable';
  err.availability = result;
  throw err;
}

function normalizeCharterType(charterType) {
  const type = String(charterType || '').trim().toLowerCase();
  if (type === 'bio' || type === 'night_bio') return 'bio';
  if (type === 'sunset' || type === 'sunset_cruise') return 'sunset';
  if (type === 'rocket' || type === 'rocket_launch') return 'rocket';
  if (type === 'captain_charter' || type === 'captain-charter' || type === 'captain_led') {
    return 'captain_charter';
  }
  return type;
}

function isCaptainLedStaffCharter(charterType) {
  return normalizeCharterType(charterType) === 'captain_charter';
}

function isSharedCharterBookingRequest({
  charterType = null,
  charterSeating = null,
  charterVariant = null,
  bioPackage = null,
} = {}) {
  const seating = normalizeCharterSeating(charterSeating);
  if (seating === 'private') return false;
  if (seating === 'shared') return true;
  const variant = String(charterVariant || '').trim().toLowerCase();
  if (variant === 'private') return false;
  if (variant === 'shared') return true;
  if (bioPackage) return true;
  return normalizeCharterType(charterType) === 'bio';
}

function resolveCharterSeatingForInsert(input) {
  return isSharedCharterBookingRequest(input) ? 'shared' : 'private';
}

async function resolveCharterBoatId(charterType) {
  const normalized = normalizeCharterType(charterType);
  const tripType =
    normalized === 'bio' || normalized === 'captain_charter' ? 'captain_charter' : 'captain_charter';
  return boatCapacityService.resolveBoatIdForTripType(supabase, tripType);
}

async function prepareCharterBookingInsertFields(input) {
  const boatId = await resolveCharterBoatId(input.charterType);
  const charter_seating = resolveCharterSeatingForInsert(input);
  return { boat_id: boatId, charter_seating };
}

function formatDepartureFullMessage(startIso) {
  const start = DateTime.fromISO(String(startIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!start.isValid) return DEPARTURE_FULL_MESSAGE;
  return `The ${start.toFormat('h:mm a')} departure is now full. Please select another available time.`;
}

function charterUnavailableUserMessage(result, startIso = null) {
  if (result?.reason === 'charter_capacity') {
    return result.message || formatDepartureFullMessage(startIso);
  }
  if (result?.reason === 'invalid_passenger_count') {
    return result.message;
  }
  if (result?.message) return result.message;
  return SLOT_TAKEN_USER_MESSAGE;
}

function logBookingConflictDecision(payload) {
  const safe = {
    bookingSource: payload.bookingSource || null,
    requestedDate: payload.requestedDate || null,
    requestedStart: payload.requestedStart || null,
    requestedEnd: payload.requestedEnd || null,
    normalizedStart: payload.normalizedStart || null,
    normalizedEnd: payload.normalizedEnd || null,
    businessTimezone: BUSINESS_TZ,
    boatId: payload.boatId || null,
    guestCount: payload.guestCount ?? null,
    existingGuestCount: payload.existingGuestCount ?? null,
    capacity: payload.capacity ?? null,
    conflictingBookingIds: payload.conflictingBookingIds || [],
    decision: payload.decision || null,
    reason: payload.reason || null,
    charterType: payload.charterType || null,
    charterSeating: payload.charterSeating || null,
    shared: payload.shared ?? null,
  };
  console.info('[booking-conflict]', JSON.stringify(safe));
}

function conflictDecisionPayload(result, slot, input, boatId, shared) {
  const conflictingBookingIds = [];
  if (result.conflict?.id) conflictingBookingIds.push(String(result.conflict.id));
  return {
    bookingSource: input.bookingSource || null,
    requestedStart: input.startTime || null,
    requestedEnd: input.endTime || null,
    normalizedStart: slot?.startIso || null,
    normalizedEnd: slot?.endIso || null,
    boatId: boatId || null,
    guestCount: input.passengerCount ?? null,
    existingGuestCount: result.capacity?.used ?? null,
    capacity: result.capacity?.max ?? null,
    conflictingBookingIds,
    decision: result.available ? 'allow' : 'deny',
    reason: result.reason || null,
    charterType: input.charterType || null,
    charterSeating: shared ? 'shared' : 'private',
    shared,
  };
}

function charterStartHoursForType(charterType) {
  return normalizeCharterType(charterType) === 'bio'
    ? BIO_CHARTER_START_HOURS
    : DEFAULT_CHARTER_START_HOURS;
}

function getCaptainNightWindowStart(anchorDay) {
  if (!anchorDay?.isValid || !CAPTAIN_NIGHT_WEEKDAYS.has(anchorDay.weekday)) return null;
  return anchorDay.set({
    hour: CAPTAIN_NIGHT_START_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

function getCaptainNightWindowEnd(localStart) {
  const anchorDay = getCaptainNightAnchorDay(localStart);
  if (!anchorDay || !CAPTAIN_NIGHT_WEEKDAYS.has(anchorDay.weekday)) return null;
  return anchorDay.plus({ days: 1 }).set({
    hour: CAPTAIN_NIGHT_END_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

function validateCharterSlotWindow({ charterType, startIso, endIso }) {
  const start = DateTime.fromISO(String(startIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  const end = DateTime.fromISO(String(endIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!start.isValid || !end.isValid) {
    return { valid: false, message: 'Invalid charter start time.' };
  }
  if (end <= start) {
    return { valid: false, message: 'End time must be after start time.' };
  }

  const anchorDay = getCaptainNightAnchorDay(start);
  const windowEnd = getCaptainNightWindowEnd(start);
  const windowStart = anchorDay ? getCaptainNightWindowStart(anchorDay) : null;
  if (!anchorDay || !windowEnd || !windowStart) {
    return { valid: false, message: captainNightUnavailableMessage(start) };
  }

  if (start < windowStart || start >= windowEnd) {
    return { valid: false, message: captainNightUnavailableMessage(start) };
  }
  if (end > windowEnd || end <= windowStart) {
    return {
      valid: false,
      message: end > windowEnd ? CHARTER_END_TOO_LATE_MESSAGE : captainNightUnavailableMessage(start),
    };
  }

  const endAnchor = getCaptainNightAnchorDay(end);
  if (!endAnchor || endAnchor.toMillis() !== anchorDay.toMillis()) {
    return { valid: false, message: captainNightUnavailableMessage(start) };
  }

  const type = normalizeCharterType(charterType);
  if (type === 'bio') {
    if (start.minute !== 0 || !BIO_CHARTER_START_HOURS.has(start.hour)) {
      return { valid: false, message: BIO_CHARTER_TIME_MESSAGE };
    }
  } else if (!isCaptainLedStaffCharter(charterType)) {
    if (start.hour <= CAPTAIN_NIGHT_END_HOUR || start.hour < CAPTAIN_NIGHT_START_HOUR) {
      return { valid: false, message: NON_BIO_LATE_NIGHT_MESSAGE };
    }
  }

  return { valid: true, message: null };
}

function assertCharterSlotWindow(input) {
  const result = validateCharterSlotWindow(input);
  if (result.valid) return result;
  const err = new Error(result.message || CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE);
  err.statusCode = 400;
  throw err;
}

function enumerateCharterStartsForDay(day, charterType) {
  const hours = charterStartHoursForType(charterType);
  const candidates = [];
  const dow = day.weekday;

  for (const hour of hours) {
    if (hour >= 0 && hour <= CAPTAIN_NIGHT_END_HOUR) {
      const prevDow = day.minus({ days: 1 }).weekday;
      if (!CAPTAIN_NIGHT_WEEKDAYS.has(prevDow)) continue;
      candidates.push(day.set({ hour, minute: 0, second: 0, millisecond: 0 }));
      continue;
    }
    if (hour >= CAPTAIN_NIGHT_START_HOUR && CAPTAIN_NIGHT_WEEKDAYS.has(dow)) {
      candidates.push(day.set({ hour, minute: 0, second: 0, millisecond: 0 }));
    }
  }

  return candidates;
}

async function loadCharterExternalBlockingIntervals(rangeStartIso, rangeEndIso) {
  const [blocked, adminBlocks] = await Promise.all([
    fetchFleetBlockedDateRanges(rangeStartIso, rangeEndIso),
    fetchFleetAdminBlockingItemRanges(rangeStartIso, rangeEndIso),
  ]);
  return toIntervals(blocked, 'start_time', 'end_time').concat(
    toIntervals(adminBlocks, 'start_time', 'end_time')
  );
}

async function loadCharterBlockingIntervals(rangeStartIso, rangeEndIso) {
  const [charters, externalBlocks] = await Promise.all([
    fetchBlockingCharters(rangeStartIso, rangeEndIso),
    loadCharterExternalBlockingIntervals(rangeStartIso, rangeEndIso),
  ]);
  return toIntervals(charters, 'start_time', 'end_time').concat(externalBlocks);
}

async function checkUnifiedCharterSlotAvailability({
  startTime,
  endTime,
  charterType = null,
  charterSeating = null,
  charterVariant = null,
  bioPackage = null,
  passengerCount = 1,
  excludeBookingId = null,
  bookingSource = null,
} = {}) {
  const slot = parseSlotRange(startTime, endTime);
  const windowCheck = validateCharterSlotWindow({
    charterType,
    startIso: slot.startIso,
    endIso: slot.endIso,
  });
  if (!windowCheck.valid) {
    const result = {
      available: false,
      reason: 'captain_window',
      conflict: null,
      message: windowCheck.message,
      boatId: null,
      charterSeating: null,
    };
    logBookingConflictDecision(
      conflictDecisionPayload(result, slot, { startTime, endTime, charterType, bookingSource }, null, false)
    );
    return result;
  }
  if (!isStartTimeAllowed(slot.startIso)) {
    const result = {
      available: false,
      reason: 'lead_time',
      conflict: null,
      message: SLOT_TOO_SOON_USER_MESSAGE,
      boatId: null,
      charterSeating: null,
    };
    logBookingConflictDecision(
      conflictDecisionPayload(result, slot, { startTime, endTime, charterType, bookingSource }, null, false)
    );
    return result;
  }

  const shared = isSharedCharterBookingRequest({
    charterType,
    charterSeating,
    charterVariant,
    bioPackage,
  });
  const boatId = await resolveCharterBoatId(charterType);
  const charterSeatingResolved = shared ? 'shared' : 'private';

  if (shared) {
    if (!boatId) {
      const result = {
        available: false,
        reason: 'no_boat',
        conflict: null,
        message: 'Charter boat is not available for this departure. Please call us for help.',
        boatId: null,
        charterSeating: charterSeatingResolved,
      };
      logBookingConflictDecision(
        conflictDecisionPayload(
          result,
          slot,
          { startTime, endTime, charterType, passengerCount, bookingSource },
          null,
          true
        )
      );
      return result;
    }
    const result = await checkSharedCharterSlotAvailability({
      boatId,
      startTime: slot.startIso,
      endTime: slot.endIso,
      passengerCount,
      excludeBookingId,
    });
    const unified = {
      ...result,
      boatId,
      charterSeating: charterSeatingResolved,
      message:
        result.reason === 'charter_capacity'
          ? formatDepartureFullMessage(slot.startIso)
          : result.message,
    };
    logBookingConflictDecision(
      conflictDecisionPayload(
        unified,
        slot,
        { startTime, endTime, charterType, passengerCount, bookingSource },
        boatId,
        true
      )
    );
    return unified;
  }

  if (boatId) {
    const result = await checkBookingSlotAvailability({
      boatId,
      startTime: slot.startIso,
      endTime: slot.endIso,
      excludeBookingId,
    });
    const unified = {
      ...result,
      boatId,
      charterSeating: charterSeatingResolved,
      message: result.available ? null : SLOT_TAKEN_USER_MESSAGE,
    };
    logBookingConflictDecision(
      conflictDecisionPayload(
        unified,
        slot,
        { startTime, endTime, charterType, passengerCount, bookingSource },
        boatId,
        false
      )
    );
    return unified;
  }

  const result = await checkCharterSlotAvailability({
    startTime: slot.startIso,
    endTime: slot.endIso,
    charterType,
    excludeBookingId,
  });
  const unified = {
    ...result,
    boatId: null,
    charterSeating: charterSeatingResolved,
    message: result.available ? null : SLOT_TAKEN_USER_MESSAGE,
  };
  logBookingConflictDecision(
    conflictDecisionPayload(
      unified,
      slot,
      { startTime, endTime, charterType, passengerCount, bookingSource },
      null,
      false
    )
  );
  return unified;
}

async function assertUnifiedCharterSlotAvailable(input) {
  const result = await checkUnifiedCharterSlotAvailability(input);
  if (result.available) return result;

  const err = new Error(charterUnavailableUserMessage(result, input?.startTime));
  err.statusCode =
    result.reason === 'captain_window' || result.reason === 'invalid_passenger_count' ? 400 : 409;
  err.code = result.reason || 'slot_unavailable';
  err.availability = result;
  throw err;
}

async function checkCharterSlotAvailability({
  startTime,
  endTime,
  charterType = null,
  excludeBookingId = null,
} = {}) {
  const slot = parseSlotRange(startTime, endTime);
  const windowCheck = validateCharterSlotWindow({
    charterType,
    startIso: slot.startIso,
    endIso: slot.endIso,
  });
  if (!windowCheck.valid) {
    return {
      available: false,
      reason: 'captain_window',
      conflict: null,
      message: windowCheck.message,
    };
  }
  if (!isStartTimeAllowed(slot.startIso)) {
    return {
      available: false,
      reason: 'lead_time',
      conflict: null,
      message: SLOT_TOO_SOON_USER_MESSAGE,
    };
  }

  const [bookings, externalBlocks] = await Promise.all([
    fetchBlockingCharters(slot.startIso, slot.endIso),
    loadCharterExternalBlockingIntervals(slot.startIso, slot.endIso),
  ]);

  const bookingConflict = bookings.find((row) => {
    if (excludeBookingId && String(row.id) === String(excludeBookingId)) return false;
    return intervalsOverlap(
      slot.startMs,
      slot.endMs,
      new Date(String(row.start_time)).getTime(),
      new Date(String(row.end_time)).getTime()
    );
  });

  if (bookingConflict) {
    return {
      available: false,
      reason: 'charter_conflict',
      conflict: bookingConflict,
      message: null,
    };
  }

  if (slotConflicts(slot.startMs, slot.endMs, externalBlocks)) {
    return {
      available: false,
      reason: 'blocked_date',
      conflict: null,
      message: null,
    };
  }

  return {
    available: true,
    reason: null,
    conflict: null,
    message: null,
  };
}

async function assertCharterSlotAvailable(input) {
  const result = await checkCharterSlotAvailability(input);
  if (result.available) return result;

  const err = new Error(result.message || SLOT_TAKEN_USER_MESSAGE);
  err.statusCode = result.reason === 'captain_window' ? 400 : 409;
  err.code = result.reason || 'slot_unavailable';
  err.availability = result;
  throw err;
}

async function listCharterSlotsForDay(dateStr, charterType, options = {}) {
  const day = parseDateOnlyInZone(dateStr, BUSINESS_TZ);
  if (!day) return [];

  const duration = CHARTER_DURATION_HOURS;
  const durMs = duration * 60 * 60 * 1000;
  const rangeStartIso = day.startOf('day').toUTC().toISO();
  const rangeEndIso = day.plus({ days: 1 }).toUTC().toISO();
  const normalizedType = normalizeCharterType(charterType);
  const sharedListing = isSharedCharterBookingRequest({
    charterType: normalizedType,
    charterVariant: options.charterVariant,
    bioPackage: options.bioPackage,
  });
  const boatId = sharedListing ? await resolveCharterBoatId(charterType) : null;
  const intervals =
    sharedListing && boatId
      ? await loadCharterExternalBlockingIntervals(rangeStartIso, rangeEndIso)
      : await loadCharterBlockingIntervals(rangeStartIso, rangeEndIso);
  const starts = enumerateCharterStartsForDay(day, charterType);
  const minStartMs = minBookableStartMs();
  const minGuests = Math.max(1, Number(options.passengerCount || options.minGuests || 1) || 1);
  const out = [];

  for (const startDt of starts) {
    const startMs = startDt.toUTC().toMillis();
    if (startMs < minStartMs) continue;
    const endMs = startMs + durMs;
    const endDt = DateTime.fromMillis(endMs, { zone: 'utc' }).setZone(BUSINESS_TZ);
    const windowCheck = validateCharterSlotWindow({
      charterType,
      startIso: startDt.toUTC().toISO(),
      endIso: endDt.toUTC().toISO(),
    });
    if (!windowCheck.valid) continue;

    let available = false;
    let capacity = null;
    if (sharedListing && boatId) {
      const availability = await checkSharedCharterSlotAvailability({
        boatId,
        startTime: startDt.toUTC().toISO(),
        endTime: endDt.toUTC().toISO(),
        passengerCount: minGuests,
      });
      available = availability.available;
      capacity = availability.capacity || null;
      if (available && slotConflicts(startMs, endMs, intervals)) {
        available = false;
      }
    } else if (!slotConflicts(startMs, endMs, intervals)) {
      available = true;
    }

    if (available) {
      out.push({
        start: new Date(startMs).toISOString(),
        end: endDt.toUTC().toISO(),
        label: startDt.setZone(BUSINESS_TZ).toFormat('h:mm a'),
        startHHMM: startDt.setZone(BUSINESS_TZ).toFormat('HH:mm'),
        available: true,
        capacity,
      });
    }
  }
  return normalizeSlotRows(out);
}

async function listCharterDatesAvailability(fromDateStr, toDateStr, charterType) {
  const from = parseDateOnlyInZone(fromDateStr, BUSINESS_TZ);
  const to = parseDateOnlyInZone(toDateStr, BUSINESS_TZ);
  if (!from || !to || to < from) {
    throw new Error('Invalid date range');
  }

  const dates = [];
  let cursor = from.startOf('day');
  const endDay = to.startOf('day');

  while (cursor <= endDay) {
    const isoDate = cursor.toFormat('yyyy-MM-dd');
    const slots = await listCharterSlotsForDay(isoDate, charterType);
    dates.push({
      date: isoDate,
      available: slots.length > 0,
      slotsRemaining: slots.length,
    });
    cursor = cursor.plus({ days: 1 });
  }

  return dates;
}

/**
 * @param {object} opts
 * @param {string} opts.boatId
 * @param {string} opts.rangeStartIso inclusive window start (UTC ISO)
 * @param {string} opts.rangeEndIso exclusive or inclusive end - use full day coverage
 */
async function loadBlockingIntervals(boatId, rangeStartIso, rangeEndIso) {
  const [bookings, blocked, adminBlocks] = await Promise.all([
    fetchBlockingBookings(boatId, rangeStartIso, rangeEndIso),
    fetchBlockedDateRanges(boatId, rangeStartIso, rangeEndIso),
    fetchAdminBlockingItemRanges(boatId, rangeStartIso, rangeEndIso),
  ]);
  const bi = toIntervals(bookings, 'start_time', 'end_time');
  const bd = toIntervals(blocked, 'start_time', 'end_time');
  const ab = toIntervals(adminBlocks, 'start_time', 'end_time');
  return bi.concat(bd, ab);
}

function parseDateOnlyInZone(dateStr, zone) {
  const [y, m, d] = String(dateStr)
    .split('-')
    .map((n) => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = DateTime.fromObject({ year: y, month: m, day: d }, { zone });
  return dt.isValid ? dt : null;
}

/**
 * Enumerate candidate start DateTimes on a calendar day in BUSINESS_TZ.
 * Booking must finish by closeHour (interpreted as hour:00 local); starts stepMinutes apart.
 */
function enumerateStartsForDay(dayStart, openHour, closeHour, durationHours, stepMinutes) {
  const durMin = Math.round(Number(durationHours) * 60);
  const step = Math.max(5, Number(stepMinutes) || 30);
  const openMin = Math.round(Number(openHour) * 60);
  const closeMin = Math.round(Number(closeHour) * 60);
  const lastStartMin = closeMin - durMin;
  if (lastStartMin < openMin) return [];

  const slots = [];
  for (let m = openMin; m <= lastStartMin; m += step) {
    const hh = Math.floor(m / 60);
    const mm = Math.round(m % 60);
    slots.push(dayStart.set({ hour: hh, minute: mm, second: 0, millisecond: 0 }));
  }
  return slots;
}

function minBookableStartMs(nowDt = DateTime.now().setZone(BUSINESS_TZ)) {
  return nowDt.startOf('minute').plus({ hours: MIN_LEAD_HOURS }).toUTC().toMillis();
}

function isStartTimeAllowed(startIso, nowDt = DateTime.now().setZone(BUSINESS_TZ)) {
  const start = DateTime.fromISO(String(startIso || ''), { zone: 'utc' });
  if (!start.isValid) return false;
  return start.toMillis() >= minBookableStartMs(nowDt);
}

function dayHasAnyFreeSlot(day, intervals, durationHours, openHour, closeHour, stepMinutes) {
  const duration = Number(durationHours) || 4;
  const durMs = duration * 60 * 60 * 1000;
  const dayStart = day.startOf('day');
  const starts = enumerateStartsForDay(dayStart, openHour, closeHour, duration, stepMinutes);
  const minStartMs = minBookableStartMs();
  for (const startDt of starts) {
    const startMs = startDt.toUTC().toMillis();
    if (startMs < minStartMs) continue;
    const endMs = startMs + durMs;
    if (!slotConflicts(startMs, endMs, intervals)) {
      return true;
    }
  }
  return false;
}

async function listSlotsForDay(boatId, dateStr, durationHours, openHour, closeHour, stepMinutes) {
  const duration = Number(durationHours) || 4;
  const durMs = duration * 60 * 60 * 1000;

  const day = parseDateOnlyInZone(dateStr, BUSINESS_TZ);
  if (!day) return [];

  const dayStart = day.startOf('day');
  const rangeStartIso = dayStart.toUTC().toISO();
  const rangeEndIso = dayStart.plus({ days: 1 }).toUTC().toISO();

  const intervals = await loadBlockingIntervals(boatId, rangeStartIso, rangeEndIso);
  const starts = enumerateStartsForDay(dayStart, openHour, closeHour, duration, stepMinutes);
  const minStartMs = minBookableStartMs();
  const out = [];

  for (const startDt of starts) {
    const startMs = startDt.toUTC().toMillis();
    if (startMs < minStartMs) continue;
    const endMs = startMs + durMs;
    if (!slotConflicts(startMs, endMs, intervals)) {
      const endDt = DateTime.fromMillis(endMs, { zone: 'utc' });
      out.push({
        start: new Date(startMs).toISOString(),
        end: endDt.toUTC().toISO(),
        label: startDt.setZone(BUSINESS_TZ).toFormat('h:mm a'),
        startHHMM: startDt.setZone(BUSINESS_TZ).toFormat('HH:mm'),
        available: true,
      });
    }
  }
  return normalizeSlotRows(out);
}

async function fetchActiveBoatIds() {
  const { data, error } = await supabase.from('boats').select('id').eq('is_active', true);
  if (error) throw new Error(error.message || 'Could not load boats');
  return (data || []).map((r) => String(r.id)).filter(Boolean);
}

/**
 * Fleet calendar: a day is available if at least one active boat has a free slot
 * for this trip length (same overlap rules as single-boat availability).
 */
async function listDatesAvailability(fromDateStr, toDateStr, durationHours, openHour, closeHour, stepMinutes) {
  const from = parseDateOnlyInZone(fromDateStr, BUSINESS_TZ);
  const to = parseDateOnlyInZone(toDateStr, BUSINESS_TZ);
  if (!from || !to || to < from) {
    throw new Error('Invalid date range');
  }

  const rangeStartIso = from.startOf('day').toUTC().toISO();
  const rangeEndIso = to.plus({ days: 1 }).startOf('day').toUTC().toISO();

  const boatIds = await fetchActiveBoatIds();
  const intervalsByBoat =
    boatIds.length === 0
      ? []
      : await Promise.all(
          boatIds.map(async (bid) => ({
            boatId: bid,
            intervals: await loadBlockingIntervals(bid, rangeStartIso, rangeEndIso),
          }))
        );

  const totalBoats = boatIds.length;
  const dates = [];
  let cursor = from.startOf('day');
  const endDay = to.startOf('day');

  while (cursor <= endDay) {
    const isoDate = cursor.toFormat('yyyy-MM-dd');
    let boatsRemaining = 0;
    for (const { intervals } of intervalsByBoat) {
      if (dayHasAnyFreeSlot(cursor, intervals, durationHours, openHour, closeHour, stepMinutes)) {
        boatsRemaining += 1;
      }
    }
    const available = totalBoats > 0 && boatsRemaining > 0;
    dates.push({
      date: isoDate,
      available,
      boatsRemaining,
      totalBoats,
    });
    cursor = cursor.plus({ days: 1 });
  }

  return dates;
}

function defaultFromTo() {
  const now = DateTime.now().setZone(BUSINESS_TZ).startOf('day');
  const from = now.toFormat('yyyy-MM-dd');
  const to = now.plus({ days: DEFAULT_RANGE_DAYS }).toFormat('yyyy-MM-dd');
  return { from, to };
}

module.exports = {
  BUSINESS_TZ,
  DEFAULT_OPEN_HOUR,
  DEFAULT_CLOSE_HOUR,
  DEFAULT_STEP_MINUTES,
  DEFAULT_RANGE_DAYS,
  MIN_LEAD_HOURS,
  CAPTAIN_NIGHT_START_HOUR,
  CAPTAIN_NIGHT_END_HOUR,
  BLOCKING_BOOKING_STATUSES,
  SLOT_TAKEN_USER_MESSAGE,
  SLOT_TOO_SOON_USER_MESSAGE,
  DEPARTURE_FULL_MESSAGE,
  defaultFromTo,
  normalizeSlotRows,
  resolveRentalBoatForLocation,
  resolveCharterBoatId,
  resolveCharterSeatingForInsert,
  prepareCharterBookingInsertFields,
  isSharedCharterBookingRequest,
  listRentalSlotsForLocation,
  rentalTripTypeForLocation,
  assertCharterSlotAvailable,
  assertUnifiedCharterSlotAvailable,
  assertCharterSlotWindow,
  assertBookingSlotAvailable,
  checkCharterSlotAvailability,
  checkUnifiedCharterSlotAvailability,
  checkBookingSlotAvailability,
  checkStaffBookingAvailability,
  checkSharedCharterSlotAvailability,
  assertSharedCharterSlotAvailable,
  charterUnavailableUserMessage,
  logBookingConflictDecision,
  isStartTimeAllowed,
  listDatesAvailability,
  listSlotsForDay,
  listCharterDatesAvailability,
  listCharterSlotsForDay,
  validateCharterSlotWindow,
  parseDateOnlyInZone,
  enumerateCharterStartsForDay,
};
