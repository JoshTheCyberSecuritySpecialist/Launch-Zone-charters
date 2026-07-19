import { DateTime } from 'luxon';
import { BUSINESS_TZ, resolveBookingRangeFromDuration } from './bookingDateTimeRange';

export const CAPTAIN_NIGHT_START_HOUR = 17;
export const CAPTAIN_NIGHT_END_HOUR = 4;
const CAPTAIN_NIGHT_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6, 7]);

export const CAPTAIN_NIGHT_SCHEDULE_NOTE =
  'Captain-led charters: 7 nights a week, 5:00 PM until 4:00 AM the following morning. Daytime self-drive: use Rental.';

export const CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE =
  'Captain-led charters are available every night from 5:00 PM until 4:00 AM the following morning.';

function getCaptainNightAnchorDay(localStart: DateTime) {
  if (!localStart.isValid) return null;
  if (localStart.hour <= CAPTAIN_NIGHT_END_HOUR) {
    return localStart.minus({ days: 1 }).startOf('day');
  }
  return localStart.startOf('day');
}

function getCaptainNightWindowEnd(anchorDay: DateTime) {
  return anchorDay.plus({ days: 1 }).set({
    hour: CAPTAIN_NIGHT_END_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

function getCaptainNightWindowStart(anchorDay: DateTime) {
  return anchorDay.set({
    hour: CAPTAIN_NIGHT_START_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

export function captainNightUnavailableMessage(_localStart: DateTime | null): string {
  return CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE;
}

/** Client-side preview aligned with server validateCharterSlotWindow for captain_charter. */
export function previewCaptainCharterWindow(
  date: string,
  startTime: string,
  durationHours: number
): { valid: boolean; message: string | null } {
  const resolved = resolveBookingRangeFromDuration({ date, startTime, durationHours });
  if (!resolved.ok) {
    return { valid: false, message: resolved.error };
  }
  const start = DateTime.fromISO(resolved.startIso, { zone: 'utc' }).setZone(BUSINESS_TZ);
  const end = DateTime.fromISO(resolved.endIso, { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!start.isValid || !end.isValid || end <= start) {
    return { valid: false, message: 'End time must be after start time.' };
  }

  const anchorDay = getCaptainNightAnchorDay(start);
  if (!anchorDay || !CAPTAIN_NIGHT_WEEKDAYS.has(anchorDay.weekday)) {
    return { valid: false, message: captainNightUnavailableMessage(start) };
  }

  const windowStart = getCaptainNightWindowStart(anchorDay);
  const windowEnd = getCaptainNightWindowEnd(anchorDay);
  if (start < windowStart || start >= windowEnd) {
    return { valid: false, message: captainNightUnavailableMessage(start) };
  }
  if (end > windowEnd) {
    return { valid: false, message: 'Bookings must finish by 4:00 AM.' };
  }
  const endAnchor = getCaptainNightAnchorDay(end);
  if (!endAnchor || endAnchor.toMillis() !== anchorDay.toMillis()) {
    return { valid: false, message: captainNightUnavailableMessage(start) };
  }

  return { valid: true, message: null };
}
