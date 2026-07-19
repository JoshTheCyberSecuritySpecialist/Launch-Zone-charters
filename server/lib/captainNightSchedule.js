const { DateTime } = require('luxon');

const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();
const CAPTAIN_NIGHT_START_HOUR = Number(process.env.CAPTAIN_NIGHT_START_HOUR || 17);
const CAPTAIN_NIGHT_END_HOUR = Number(process.env.CAPTAIN_NIGHT_END_HOUR || 4);

/** Luxon weekday: Mon=1 … Sat=6. Sunday evening charters are not offered. */
const CAPTAIN_NIGHT_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6]);

const CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE =
  'Captain-led charters are available Monday through Saturday nights from 5:00 PM until 4:00 AM the following morning.';

const CAPTAIN_NIGHT_SCHEDULE_NOTE =
  'Captain-led charters: Monday–Saturday, 5:00 PM until 4:00 AM the following morning. Sunday is not available. Daytime self-drive: use Rental.';

function charterClosedLocalIntervalsForDay(day) {
  const dow = day.weekday;
  const dayStart = day.startOf('day');
  const intervals = [];
  const eveningOpen = dayStart.set({
    hour: CAPTAIN_NIGHT_START_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const morningCloseEnd = dayStart.set({
    hour: CAPTAIN_NIGHT_START_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const morningCloseStart = dayStart.set({
    hour: CAPTAIN_NIGHT_END_HOUR,
    minute: 1,
    second: 0,
    millisecond: 0,
  });

  if (dow >= 1 && dow <= 6) {
    intervals.push({ start: dayStart, end: eveningOpen });
    if (dow >= 2) {
      intervals.push({ start: morningCloseStart, end: morningCloseEnd });
    }
    return intervals;
  }

  if (dow === 7) {
    intervals.push({
      start: morningCloseStart,
      end: dayStart.plus({ days: 1 }),
    });
  }

  return intervals;
}

function captainNightUnavailableMessage(localStart) {
  const anchor = localStart?.isValid ? getCaptainNightAnchorDay(localStart) : null;
  if (anchor && anchor.weekday === 7) {
    return `${CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE} Sunday trips are not available.`;
  }
  if (anchor && !CAPTAIN_NIGHT_WEEKDAYS.has(anchor.weekday)) {
    return CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE;
  }
  return CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE;
}

function getCaptainNightAnchorDay(localStart) {
  if (!localStart?.isValid) return null;
  if (localStart.hour <= CAPTAIN_NIGHT_END_HOUR) {
    return localStart.minus({ days: 1 }).startOf('day');
  }
  return localStart.startOf('day');
}

module.exports = {
  BUSINESS_TZ,
  CAPTAIN_NIGHT_END_HOUR,
  CAPTAIN_NIGHT_SCHEDULE_NOTE,
  CAPTAIN_NIGHT_START_HOUR,
  CAPTAIN_NIGHT_UNAVAILABLE_MESSAGE,
  CAPTAIN_NIGHT_WEEKDAYS,
  charterClosedLocalIntervalsForDay,
  captainNightUnavailableMessage,
  getCaptainNightAnchorDay,
};
