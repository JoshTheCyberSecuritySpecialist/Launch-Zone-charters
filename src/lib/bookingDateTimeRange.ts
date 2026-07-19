import { DateTime } from 'luxon';

export const BUSINESS_TZ = 'America/New_York';

export const END_BEFORE_START_MESSAGE = 'End time must be after start time.';
export const MISSING_TIME_MESSAGE = 'Valid date, start time, and end time are required.';

export function normalizeClockTime(raw: string): string {
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

function parseLocalDateTime(dateYmd: string, clockTime: string, zone = BUSINESS_TZ) {
  const date = String(dateYmd || '').trim();
  const time = normalizeClockTime(clockTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return null;
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  return dt.isValid ? dt : null;
}

export type ResolvedBookingRange =
  | {
      ok: true;
      startIso: string;
      endIso: string;
      crossesMidnight: boolean;
      durationMinutes: number;
      durationHours: number;
    }
  | { ok: false; error: string };

export function resolveBookingDateTimeRange({
  date,
  startTime,
  endTime,
  timeZone = BUSINESS_TZ,
}: {
  date: string;
  startTime: string;
  endTime: string;
  timeZone?: string;
}): ResolvedBookingRange {
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
    startIso: start.toUTC().toISO()!,
    endIso: end.toUTC().toISO()!,
    crossesMidnight,
    durationMinutes,
    durationHours: Math.round((durationMinutes / 60) * 100) / 100,
  };
}

export function resolveBookingRangeFromDuration({
  date,
  startTime,
  durationHours,
  timeZone = BUSINESS_TZ,
}: {
  date: string;
  startTime: string;
  durationHours: number;
  timeZone?: string;
}): ResolvedBookingRange {
  const start = parseLocalDateTime(date, startTime, timeZone);
  if (!start || !Number.isFinite(durationHours) || durationHours <= 0) {
    return { ok: false, error: MISSING_TIME_MESSAGE };
  }
  const end = start.plus({ minutes: Math.round(durationHours * 60) });
  const durationMinutes = Math.round(end.diff(start, 'minutes').minutes);
  return {
    ok: true,
    startIso: start.toUTC().toISO()!,
    endIso: end.toUTC().toISO()!,
    crossesMidnight: !start.hasSame(end, 'day'),
    durationMinutes,
    durationHours: Math.round((durationMinutes / 60) * 100) / 100,
  };
}

export function bookingFormTimesFromIso(startIso: string, endIso: string, timeZone = BUSINESS_TZ) {
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

export function endsFollowingDay(date: string, startTime: string, endTime: string): boolean {
  if (!date || !startTime || !endTime) return false;
  const start = parseLocalDateTime(date, startTime);
  const end = parseLocalDateTime(date, endTime);
  if (!start || !end) return false;
  if (end <= start) return true;
  return !start.hasSame(end, 'day');
}

export function formatEndDayNote(date: string, startTime: string, endTime: string): string | null {
  if (!endsFollowingDay(date, startTime, endTime)) return null;
  const start = parseLocalDateTime(date, startTime);
  let end = parseLocalDateTime(date, endTime);
  if (!start || !end) return 'Ends the following day';
  if (end <= start) end = end.plus({ days: 1 });
  return `Ends the following day (${end.toFormat('cccc, h:mm a')})`;
}
