/**
 * Shared bioluminescence fill-forward: offer one open departure at a time.
 * Pure ranking over already-eligible slots — availability filters stay elsewhere.
 */

const { DateTime } = require('luxon');
const { getCaptainNightAnchorDay, BUSINESS_TZ } = require('../lib/captainNightSchedule');
const { CHARTER_MAX_PASSENGERS } = require('../lib/sharedCharterCapacity');

const BIO_SHARED_FILL_FORWARD_MESSAGE =
  'We fill one departure at a time. When one boat fills, additional guests may be placed on our next available charter boat. Join the currently available departure below, or choose a private tour to select another available time.';

const BIO_PRIVATE_UPSELL_MESSAGE =
  'Need a different time? Reserve the entire boat with a private tour.';

const BIO_DEPARTURE_JUST_FILLED_MESSAGE =
  'That departure just filled. Please select the next available time.';

function slotStartMs(slot) {
  const iso = String(slot?.start || slot?.startIso || '').trim();
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function slotUsedGuests(slot) {
  const used = Number(slot?.capacity?.used);
  if (Number.isFinite(used) && used >= 0) return Math.floor(used);
  const remaining = Number(slot?.capacity?.remaining);
  const max = Number(slot?.capacity?.max);
  if (Number.isFinite(remaining) && Number.isFinite(max)) {
    return Math.max(0, Math.floor(max) - Math.floor(remaining));
  }
  return 0;
}

/** Guests already on any fleet boat at this departure (fill-forward ranking). */
function slotFleetUsedGuests(slot) {
  const fleetUsed = Number(slot?.capacity?.fleetUsed);
  if (Number.isFinite(fleetUsed) && fleetUsed >= 0) return Math.floor(fleetUsed);
  return slotUsedGuests(slot);
}

function slotRemainingGuests(slot) {
  const remaining = Number(slot?.capacity?.remaining);
  if (Number.isFinite(remaining) && remaining >= 0) return Math.floor(remaining);
  const used = slotUsedGuests(slot);
  const max = Number(slot?.capacity?.max);
  const capacity = Number.isFinite(max) && max > 0 ? Math.floor(max) : CHARTER_MAX_PASSENGERS;
  return Math.max(0, capacity - used);
}

function operatingAnchorKey(slot) {
  const iso = String(slot?.start || slot?.startIso || '').trim();
  const start = DateTime.fromISO(iso, { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!start.isValid) return 'invalid';
  const anchor = getCaptainNightAnchorDay(start);
  return anchor ? anchor.toFormat('yyyy-MM-dd') : start.toFormat('yyyy-MM-dd');
}

/**
 * Among eligible shared slots for one operating night, return the single fill target
 * when a departure is already partially filled. On a completely open night, returns null
 * so callers can surface every open start time.
 */
function selectFillForwardTarget(eligibleSlots) {
  const sorted = (eligibleSlots || [])
    .filter((slot) => Number.isFinite(slotStartMs(slot)))
    .sort((a, b) => slotStartMs(a) - slotStartMs(b));
  if (sorted.length === 0) return null;

  const partialOpen = sorted.filter((slot) => {
    const fleetUsed = slotFleetUsedGuests(slot);
    const remaining = slotRemainingGuests(slot);
    return fleetUsed > 0 && remaining > 0;
  });
  if (partialOpen.length > 0) return partialOpen[0];
  return null;
}

function openEligibleSlots(eligibleSlots) {
  return (eligibleSlots || [])
    .filter((slot) => Number.isFinite(slotStartMs(slot)) && slotRemainingGuests(slot) > 0)
    .sort((a, b) => slotStartMs(a) - slotStartMs(b));
}

/**
 * Apply fill-forward independently per operating night (anchor day).
 * - Partial departure open → only that fill target (one departure at a time).
 * - Completely open night → all eligible open starts (no false scarcity).
 */
function applyBioSharedFillForward(eligibleSlots) {
  const groups = new Map();
  for (const slot of eligibleSlots || []) {
    const key = operatingAnchorKey(slot);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  }
  const out = [];
  for (const group of groups.values()) {
    const target = selectFillForwardTarget(group);
    if (target) {
      out.push(target);
      continue;
    }
    out.push(...openEligibleSlots(group));
  }
  return out.sort((a, b) => slotStartMs(a) - slotStartMs(b));
}

function isRequestedStartFillForwardTarget(eligibleSlots, requestedStartIso) {
  const requestedMs = new Date(String(requestedStartIso || '')).getTime();
  if (!Number.isFinite(requestedMs)) return false;

  const target = selectFillForwardTarget(eligibleSlots);
  if (target) {
    return slotStartMs(target) === requestedMs;
  }

  return openEligibleSlots(eligibleSlots).some((slot) => slotStartMs(slot) === requestedMs);
}

module.exports = {
  BIO_SHARED_FILL_FORWARD_MESSAGE,
  BIO_PRIVATE_UPSELL_MESSAGE,
  BIO_DEPARTURE_JUST_FILLED_MESSAGE,
  applyBioSharedFillForward,
  isRequestedStartFillForwardTarget,
  operatingAnchorKey,
  selectFillForwardTarget,
  slotFleetUsedGuests,
  slotRemainingGuests,
  slotStartMs,
  slotUsedGuests,
  openEligibleSlots,
};
