/**
 * Catalog duration for captain-led packages (display + future variable-length SKUs).
 * Availability, overlap, and Stripe still use CHARTER_DURATION_HOURS / durationHours: 1
 * until variable-duration scheduling is enabled.
 */

const DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES = 60;

function normalizeCharterDurationMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES;
  return Math.round(n);
}

function resolvePackageDurationMinutes(pkg) {
  return normalizeCharterDurationMinutes(pkg && pkg.durationMinutes);
}

/** 60 → "1 Hour", 90 → "1.5 Hours", 120 → "2 Hours" */
function formatCharterDurationLabel(minutes) {
  const totalMinutes = normalizeCharterDurationMinutes(minutes);
  const hours = totalMinutes / 60;
  if (hours === 1) return '1 Hour';
  if (Number.isInteger(hours)) return `${hours} Hours`;
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} Hours`;
}

function formatCharterDurationTourLabel(minutes) {
  return `${formatCharterDurationLabel(minutes)} Tour`;
}

module.exports = {
  DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
  formatCharterDurationLabel,
  formatCharterDurationTourLabel,
  normalizeCharterDurationMinutes,
  resolvePackageDurationMinutes,
};
