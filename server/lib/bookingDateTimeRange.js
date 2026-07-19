const { DateTime } = require('luxon');

const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();

const END_BEFORE_START_MESSAGE = 'End time must be after start time.';
const MISSING_TIME_MESSAGE = 'Valid date, start time, and end time are required.';
const INVALID_TIME_MESSAGE = 'Invalid start or end time.';

/** Normalize HTML time input / HH:mm / HH:mm:ss to HH:mm for Luxon. */
function normalizeClockTime(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const m24 = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m24) {
    const hour = Number(m24[1]);
    const minute = Number(m24[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const m12 = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let hour = Number(m12[1]);
    const minute = Number(m12[2]);
    const meridiem = m12[3].toUpperCase();
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return '';
    if (meridiem === 'AM') {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  return '';
}

function parseLocalDateTime(dateYmd, clockTime, zone = BUSINESS_TZ) {
  const date = String(dateYmd || '').trim();
  const time = normalizeClockTime(clockTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return null;
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  return dt.isValid ? dt : null;
}

/**
 * Build a booking range from a trip date plus local clock times in BUSINESS_TZ.
 * If end <= start on that date, end is moved to the following calendar day.
 */
function resolveBookingDateTimeRange({ date, startTime, endTime, timeZone = BUSINESS_TZ } = {}) {
  const start = parseLocalDateTime(date, startTime, timeZone);
  let end = parseLocalDateTime(date, endTime, timeZone);
  if (!start || !end) {
    return { ok: false, error: MISSING_TIME_MESSAGE };
  }

  const startClock = normalizeClockTime(startTime);
  const endClock = normalizeClockTime(endTime);
  if (startClock && endClock && startClock === endClock) {
    return { ok: false, error: END_BEFORE_START_MESSAGE };
  }

  let crossesMidnight = false;
  if (end <= start) {
    end = end.plus({ days: 1 });
    crossesMidnight = true;
  }
  if (end <= start) {
    return { ok: false, error: END_BEFORE_START_MESSAGE };
  }

  const durationMinutes = Math.round(end.diff(start, 'minutes').minutes);
  return {
    ok: true,
    startDateTime: start,
    endDateTime: end,
    startIso: start.toUTC().toISO(),
    endIso: end.toUTC().toISO(),
    crossesMidnight,
    durationMinutes,
    durationHours: Math.round((durationMinutes / 60) * 100) / 100,
  };
}

function resolveBookingRangeFromDuration({ date, startTime, durationHours, timeZone = BUSINESS_TZ } = {}) {
  const start = parseLocalDateTime(date, startTime, timeZone);
  const hours = Number(durationHours);
  if (!start || !Number.isFinite(hours) || hours <= 0) {
    return { ok: false, error: MISSING_TIME_MESSAGE };
  }
  const end = start.plus({ minutes: Math.round(hours * 60) });
  const durationMinutes = Math.round(end.diff(start, 'minutes').minutes);
  const crossesMidnight = !start.hasSame(end, 'day');
  return {
    ok: true,
    startDateTime: start,
    endDateTime: end,
    startIso: start.toUTC().toISO(),
    endIso: end.toUTC().toISO(),
    crossesMidnight,
    durationMinutes,
    durationHours: Math.round((durationMinutes / 60) * 100) / 100,
  };
}

function resolveBookingRangeFromBody(body = {}) {
  const date = String(body.date || '').trim();
  const startTime = body.start_time_local || body.startTimeLocal || body.startTime || body.time || body.start_time;
  const endTime = body.end_time_local || body.endTimeLocal || body.endTime || body.end_time;
  const durationHours = body.duration_hours ?? body.durationHours;

  if (date && startTime && endTime) {
    return resolveBookingDateTimeRange({ date, startTime, endTime });
  }

  const startRaw = String(body.start_time || body.startTime || '').trim();
  const endRaw = String(body.end_time || body.endTime || '').trim();
  if (startRaw && endRaw && startRaw.includes('T') && endRaw.includes('T')) {
    const start = DateTime.fromISO(startRaw, { zone: 'utc' });
    const end = DateTime.fromISO(endRaw, { zone: 'utc' });
    if (start.isValid && end.isValid && end > start) {
      const durationMinutes = Math.round(end.diff(start, 'minutes').minutes);
      return {
        ok: true,
        startDateTime: start,
        endDateTime: end,
        startIso: start.toISO(),
        endIso: end.toISO(),
        crossesMidnight: !start.setZone(BUSINESS_TZ).hasSame(end.setZone(BUSINESS_TZ), 'day'),
        durationMinutes,
        durationHours: Math.round((durationMinutes / 60) * 100) / 100,
      };
    }
  }

  if (date && startTime && durationHours != null && durationHours !== '') {
    return resolveBookingRangeFromDuration({ date, startTime, durationHours });
  }

  return { ok: false, error: MISSING_TIME_MESSAGE };
}

function bookingFormTimesFromIso(startIso, endIso, timeZone = BUSINESS_TZ) {
  const start = DateTime.fromISO(String(startIso || ''), { zone: 'utc' }).setZone(timeZone);
  const end = DateTime.fromISO(String(endIso || ''), { zone: 'utc' }).setZone(timeZone);
  if (!start.isValid || !end.isValid) {
    return { date: '', startTime: '', endTime: '', crossesMidnight: false };
  }
  return {
    date: start.toFormat('yyyy-MM-dd'),
    startTime: start.toFormat('HH:mm'),
    endTime: end.toFormat('HH:mm'),
    crossesMidnight: !start.hasSame(end, 'day'),
  };
}

module.exports = {
  BUSINESS_TZ,
  END_BEFORE_START_MESSAGE,
  INVALID_TIME_MESSAGE,
  MISSING_TIME_MESSAGE,
  bookingFormTimesFromIso,
  normalizeClockTime,
  parseLocalDateTime,
  resolveBookingDateTimeRange,
  resolveBookingRangeFromBody,
  resolveBookingRangeFromDuration,
};
