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

const BLOCKING_BOOKING_STATUSES = new Set([
  'pending',
  'pending_verification',
  'confirmed',
  'completed',
]);

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
    .select('id, start_time, end_time, status, expires_at')
    .eq('boat_id', String(boatId))
    .lt('start_time', rangeEndIso)
    .gt('end_time', rangeStartIso);
  if (error) throw new Error(error.message || 'Could not load bookings');
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

function toIntervals(rows, keyStart, keyEnd) {
  return (rows || []).map((r) => ({
    startMs: new Date(String(r[keyStart])).getTime(),
    endMs: new Date(String(r[keyEnd])).getTime(),
  }));
}

function slotConflicts(startMs, endMs, intervals) {
  return intervals.some((iv) => intervalsOverlap(startMs, endMs, iv.startMs, iv.endMs));
}

/**
 * @param {object} opts
 * @param {string} opts.boatId
 * @param {string} opts.rangeStartIso inclusive window start (UTC ISO)
 * @param {string} opts.rangeEndIso exclusive or inclusive end - use full day coverage
 */
async function loadBlockingIntervals(boatId, rangeStartIso, rangeEndIso) {
  const [bookings, blocked] = await Promise.all([
    fetchBlockingBookings(boatId, rangeStartIso, rangeEndIso),
    fetchBlockedDateRanges(boatId, rangeStartIso, rangeEndIso),
  ]);
  const bi = toIntervals(bookings, 'start_time', 'end_time');
  const bd = toIntervals(blocked, 'start_time', 'end_time');
  return bi.concat(bd);
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

function dayHasAnyFreeSlot(day, intervals, durationHours, openHour, closeHour, stepMinutes) {
  const duration = Number(durationHours) || 4;
  const durMs = duration * 60 * 60 * 1000;
  const dayStart = day.startOf('day');
  const starts = enumerateStartsForDay(dayStart, openHour, closeHour, duration, stepMinutes);
  for (const startDt of starts) {
    const startMs = startDt.toUTC().toMillis();
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
  const out = [];

  for (const startDt of starts) {
    const startMs = startDt.toUTC().toMillis();
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
  defaultFromTo,
  listDatesAvailability,
  listSlotsForDay,
  parseDateOnlyInZone,
};
