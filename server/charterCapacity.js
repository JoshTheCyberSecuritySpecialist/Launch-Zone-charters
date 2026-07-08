/** Captain-led charter capacity: passengers + captain aboard. */
const CHARTER_MAX_PASSENGERS = 5;
const CHARTER_CAPTAIN_COUNT = 1;
const CHARTER_MAX_TOTAL_ABOARD = CHARTER_MAX_PASSENGERS + CHARTER_CAPTAIN_COUNT;
const CHARTER_MIN_PASSENGERS = 1;

function isCaptainLedCharter(bookingType) {
  return String(bookingType || '').trim() === 'charter';
}

function validateCharterPassengerCount(rawCount) {
  const count = Math.floor(Number(rawCount));
  if (!Number.isFinite(count) || count < CHARTER_MIN_PASSENGERS) {
    return {
      valid: false,
      error: `Select ${CHARTER_MIN_PASSENGERS}–${CHARTER_MAX_PASSENGERS} passengers.`,
    };
  }
  if (count > CHARTER_MAX_PASSENGERS) {
    return {
      valid: false,
      error: `Charter bookings allow up to ${CHARTER_MAX_PASSENGERS} passengers (plus captain).`,
    };
  }
  return { valid: true, count };
}

function clampCharterPassengerCount(rawCount) {
  const count = Math.floor(Number(rawCount) || CHARTER_MIN_PASSENGERS);
  return Math.min(CHARTER_MAX_PASSENGERS, Math.max(CHARTER_MIN_PASSENGERS, count));
}

module.exports = {
  CHARTER_MAX_PASSENGERS,
  CHARTER_CAPTAIN_COUNT,
  CHARTER_MAX_TOTAL_ABOARD,
  CHARTER_MIN_PASSENGERS,
  isCaptainLedCharter,
  validateCharterPassengerCount,
  clampCharterPassengerCount,
};
