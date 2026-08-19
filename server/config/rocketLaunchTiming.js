/**
 * Rocket launch charter timing — departure is derived from the scheduled launch NET.
 * Bioluminescence night windows are unrelated; do not reuse BIO_* constants here.
 */
const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();

/** Minutes before launch NET when the charter departs (on-water viewing lead time). */
const ROCKET_PRE_LAUNCH_BUFFER_MINUTES = Math.max(
  0,
  Number(process.env.ROCKET_PRE_LAUNCH_BUFFER_MINUTES || 60)
);

/** On-water charter duration ending at or around launch time. */
const ROCKET_CHARTER_DURATION_HOURS = Math.max(
  0.25,
  Number(process.env.ROCKET_CHARTER_DURATION_HOURS || 1)
);

/** Prefix for Launch Library 2 IDs stored in bookings.external_reference. */
const ROCKET_LAUNCH_EXTERNAL_REF_PREFIX = 'll2:';

module.exports = {
  BUSINESS_TZ,
  ROCKET_PRE_LAUNCH_BUFFER_MINUTES,
  ROCKET_CHARTER_DURATION_HOURS,
  ROCKET_LAUNCH_EXTERNAL_REF_PREFIX,
};
