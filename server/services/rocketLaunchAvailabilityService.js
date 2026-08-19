/**
 * Launch-event-based rocket charter availability.
 * Source of truth: Launch Library 2 launch record (id + net timestamp).
 */
const { DateTime } = require('luxon');
const rocketScheduleService = require('./rocketScheduleService');
const {
  BUSINESS_TZ,
  ROCKET_PRE_LAUNCH_BUFFER_MINUTES,
  ROCKET_CHARTER_DURATION_HOURS,
  ROCKET_LAUNCH_EXTERNAL_REF_PREFIX,
} = require('../config/rocketLaunchTiming');

const ROCKET_LAUNCH_NOT_FOUND_MESSAGE =
  'Selected rocket launch was not found or is no longer bookable.';
const ROCKET_LAUNCH_TIME_TBD_MESSAGE =
  'This launch does not have a confirmed time yet. Please choose another launch or check back later.';
const ROCKET_DEPARTURE_MISMATCH_MESSAGE =
  'Departure time does not match the selected rocket launch schedule.';
const ROCKET_LAUNCH_REQUIRED_MESSAGE =
  'A scheduled rocket launch must be selected for rocket charter bookings.';

function formatExternalLaunchRef(launchId) {
  const id = String(launchId || '').trim();
  if (!id) return null;
  if (id.startsWith(ROCKET_LAUNCH_EXTERNAL_REF_PREFIX)) return id;
  return `${ROCKET_LAUNCH_EXTERNAL_REF_PREFIX}${id}`;
}

function parseLaunchIdFromExternalRef(externalReference) {
  const raw = String(externalReference || '').trim();
  if (!raw) return null;
  if (raw.startsWith(ROCKET_LAUNCH_EXTERNAL_REF_PREFIX)) {
    return raw.slice(ROCKET_LAUNCH_EXTERNAL_REF_PREFIX.length) || null;
  }
  return raw;
}

function launchCalendarDateInZone(netIso, tz = BUSINESS_TZ) {
  const dt = DateTime.fromISO(String(netIso || ''), { zone: 'utc' }).setZone(tz);
  if (!dt.isValid) return null;
  return dt.toFormat('yyyy-MM-dd');
}

/**
 * Compute charter departure window from a launch NET instant.
 * @returns {null | object}
 */
function computeRocketCharterWindowFromNet(netIso) {
  const launchLocal = DateTime.fromISO(String(netIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!launchLocal.isValid) return null;

  const departureStart = launchLocal.minus({ minutes: ROCKET_PRE_LAUNCH_BUFFER_MINUTES });
  const departureEnd = departureStart.plus({ hours: ROCKET_CHARTER_DURATION_HOURS });

  return {
    launchNetIso: launchLocal.toUTC().toISO(),
    launchLocal,
    departureStart,
    departureEnd,
    departureStartIso: departureStart.toUTC().toISO(),
    departureEndIso: departureEnd.toUTC().toISO(),
    launchCalendarDate: launchLocal.toFormat('yyyy-MM-dd'),
    launchTimeLabel: launchLocal.toFormat('h:mm a'),
    departureTimeLabel: departureStart.toFormat('h:mm a'),
    launchDateLabel: launchLocal.toFormat('MMMM d, yyyy'),
    launchDateShortLabel: launchLocal.toFormat('MMM d, yyyy'),
  };
}

function launchPreviewFromRecord(launch) {
  if (!launch || typeof launch !== 'object') return null;
  const net = launch.net || launch.window_start || null;
  const window = net ? computeRocketCharterWindowFromNet(net) : null;
  return {
    id: launch.id,
    name: launch.name || 'Rocket launch',
    net,
    status: launch.status?.name || launch.status?.abbrev || launch.status || null,
    padName: launch.pad?.name || launch.pad?.location?.name || null,
    providerName: launch.launch_service_provider?.name || null,
    calendarDate: window?.launchCalendarDate || (net ? launchCalendarDateInZone(net) : null),
    launchTimeLabel: window?.launchTimeLabel || null,
    departureTimeLabel: window?.departureTimeLabel || null,
    departureStartIso: window?.departureStartIso || null,
    departureEndIso: window?.departureEndIso || null,
    launchDateLabel: window?.launchDateLabel || null,
  };
}

function candidateSlotsForLaunchesOnDate(launches, dateStr) {
  const out = [];
  for (const launch of launches || []) {
    const net = launch?.net || launch?.window_start || null;
    if (!net) continue;
    const window = computeRocketCharterWindowFromNet(net);
    if (!window || window.launchCalendarDate !== dateStr) continue;
    out.push({
      launch,
      window,
      launchId: String(launch.id),
    });
  }
  out.sort((a, b) => a.window.departureStart.toMillis() - b.window.departureStart.toMillis());
  return out;
}

function isoTimesMatch(aIso, bIso, toleranceMs = 60 * 1000) {
  const a = DateTime.fromISO(String(aIso || ''), { zone: 'utc' });
  const b = DateTime.fromISO(String(bIso || ''), { zone: 'utc' });
  if (!a.isValid || !b.isValid) return false;
  return Math.abs(a.toMillis() - b.toMillis()) <= toleranceMs;
}

function validateRocketLaunchSlotAgainstLaunch(launch, startIso, endIso, { minBookableStartMs = null } = {}) {
  if (!launch?.id) {
    return { valid: false, message: ROCKET_LAUNCH_NOT_FOUND_MESSAGE, launch: null, window: null };
  }
  const net = launch.net || launch.window_start || null;
  if (!net) {
    return { valid: false, message: ROCKET_LAUNCH_TIME_TBD_MESSAGE, launch, window: null };
  }

  const window = computeRocketCharterWindowFromNet(net);
  if (!window) {
    return { valid: false, message: ROCKET_LAUNCH_TIME_TBD_MESSAGE, launch, window: null };
  }

  if (!isoTimesMatch(startIso, window.departureStartIso) || !isoTimesMatch(endIso, window.departureEndIso)) {
    return {
      valid: false,
      message: ROCKET_DEPARTURE_MISMATCH_MESSAGE,
      launch,
      window,
    };
  }

  const startMs = DateTime.fromISO(String(startIso || ''), { zone: 'utc' }).toMillis();
  if (Number.isFinite(minBookableStartMs) && startMs < minBookableStartMs) {
    return {
      valid: false,
      message: 'This launch departure is too soon to book online. Please call us for help.',
      launch,
      window,
    };
  }

  return { valid: true, message: null, launch, window };
}

async function findLaunchById(launchId) {
  const id = String(launchId || '').trim();
  if (!id) return null;
  return rocketScheduleService.getLaunchById(id);
}

async function validateRocketLaunchBooking({
  launchId,
  startIso,
  endIso,
  minBookableStartMs = null,
}) {
  const launch = await findLaunchById(launchId);
  if (!launch) {
    return { valid: false, message: ROCKET_LAUNCH_NOT_FOUND_MESSAGE, launch: null, window: null };
  }
  return validateRocketLaunchSlotAgainstLaunch(launch, startIso, endIso, { minBookableStartMs });
}

function buildSlotRowFromCandidate(candidate, { available = true, capacity = null, rocketDepartureLabel = null } = {}) {
  const { launch, window, launchId } = candidate;
  const preview = launchPreviewFromRecord(launch);
  return {
    start: window.departureStartIso,
    end: window.departureEndIso,
    label: window.departureTimeLabel,
    startHHMM: window.departureStart.setZone(BUSINESS_TZ).toFormat('HH:mm'),
    available,
    capacity,
    rocketDepartureLabel,
    launchId,
    launchName: preview?.name || launch?.name || 'Rocket launch',
    launchNetIso: window.launchNetIso,
    launchTimeLabel: window.launchTimeLabel,
    launchDateLabel: window.launchDateLabel,
    launchStatus: preview?.status || null,
    launchPad: preview?.padName || null,
    externalReference: formatExternalLaunchRef(launchId),
  };
}

async function listLaunchPreviewsForRange(fromDateStr, toDateStr) {
  const from = DateTime.fromISO(String(fromDateStr || ''), { zone: BUSINESS_TZ }).startOf('day');
  const to = DateTime.fromISO(String(toDateStr || ''), { zone: BUSINESS_TZ }).startOf('day');
  if (!from.isValid || !to.isValid || to < from) {
    throw new Error('Invalid date range');
  }

  const launches = await rocketScheduleService.getLaunches();
  const previews = [];
  let cursor = from;
  while (cursor <= to) {
    const isoDate = cursor.toFormat('yyyy-MM-dd');
    const candidates = candidateSlotsForLaunchesOnDate(launches, isoDate);
    for (const candidate of candidates) {
      previews.push({
        date: isoDate,
        ...launchPreviewFromRecord(candidate.launch),
      });
    }
    cursor = cursor.plus({ days: 1 });
  }
  return previews;
}

module.exports = {
  BUSINESS_TZ,
  ROCKET_LAUNCH_NOT_FOUND_MESSAGE,
  ROCKET_LAUNCH_TIME_TBD_MESSAGE,
  ROCKET_DEPARTURE_MISMATCH_MESSAGE,
  ROCKET_LAUNCH_REQUIRED_MESSAGE,
  formatExternalLaunchRef,
  parseLaunchIdFromExternalRef,
  launchCalendarDateInZone,
  computeRocketCharterWindowFromNet,
  launchPreviewFromRecord,
  candidateSlotsForLaunchesOnDate,
  validateRocketLaunchSlotAgainstLaunch,
  validateRocketLaunchBooking,
  findLaunchById,
  buildSlotRowFromCandidate,
  listLaunchPreviewsForRange,
};
