/**
 * Server-side availability for calendar / time-slot UI.
 * Uses same overlap semantics as bookings assertSlotAvailable + blocked_dates.
 */
const { DateTime } = require('luxon');
const supabase = require('../supabaseClient');

const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();
const DEFAULT_OPEN_HOUR = Number(process.env.AVAILABILITY_OPEN_HOUR || 7);
const DEFAULT_CLOSE_HOUR = Number(process.env.AVAILABILITY_CLOSE_HOUR || 20);
const DEFAULT_STEP_MINUTES = Number(process.env.AVAILABILITY_SLOT_MINUTES || 30);
const DEFAULT_RANGE_DAYS = Number(process.env.AVAILABILITY_CALENDAR_DAYS || 60);
const MIN_LEAD_HOURS = Math.max(0, Number(process.env.BOOKING_MIN_LEAD_HOURS || 2));

const BLOCKING_BOOKING_STATUSES = new Set([
  'hold',
  'pending',
  'pending_verification',
  'confirmed',
  'ready_for_departure',
  'completed',
]);

const SLOT_TAKEN_USER_MESSAGE =
  'This time slot was just booked. Please select another time.';

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
    .select('id, start_time, end_time, status, expires_at, customer_id, boat_id, customers(full_name, email, phone), boats(name)')
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
    .select('start_time, end_time, boat_id')
    .lt('start_time', rangeEndIso)
    .gt('end_time', rangeStartIso)
    .or(`boat_id.eq.${boat},boat_id.is.null`);
  if (!error) return data || [];

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

  const err = new Error(SLOT_TAKEN_USER_MESSAGE);
  err.statusCode = 409;
  err.code = result.reason || 'slot_unavailable';
  err.availability = result;
  throw err;
}

async function checkCharterSlotAvailability({
  startTime,
  endTime,
  excludeBookingId = null,
} = {}) {
  const slot = parseSlotRange(startTime, endTime);
  const bookings = await fetchBlockingCharters(slot.startIso, slot.endIso);
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
    };
  }

  return {
    available: true,
    reason: null,
    conflict: null,
  };
}

async function assertCharterSlotAvailable(input) {
  const result = await checkCharterSlotAvailability(input);
  if (result.available) return result;

  const err = new Error(SLOT_TAKEN_USER_MESSAGE);
  err.statusCode = 409;
  err.code = result.reason || 'slot_unavailable';
  err.availability = result;
  throw err;
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
      });
    }
  }
  return out;
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
  BLOCKING_BOOKING_STATUSES,
  defaultFromTo,
  assertCharterSlotAvailable,
  assertBookingSlotAvailable,
  checkCharterSlotAvailability,
  checkBookingSlotAvailability,
  isStartTimeAllowed,
  listDatesAvailability,
  listSlotsForDay,
  parseDateOnlyInZone,
};
