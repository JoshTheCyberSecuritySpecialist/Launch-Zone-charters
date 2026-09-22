/**
 * Catalog duration for captain-led packages (display + variable-length SKUs).
 * Prefer package.durationMinutes via resolvePackageDurationMinutes / resolveCharterDurationHours.
 * Default scheduled window remains 1 hour when no package duration is supplied.
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

function resolveCharterDurationHours(pkgOrMinutes) {
  if (pkgOrMinutes && typeof pkgOrMinutes === 'object') {
    return Math.round((resolvePackageDurationMinutes(pkgOrMinutes) / 60) * 100) / 100;
  }
  const minutes = normalizeCharterDurationMinutes(pkgOrMinutes);
  return Math.round((minutes / 60) * 100) / 100;
}

function charterEndIsoFromStart(startIso, durationHours) {
  const startMs = new Date(String(startIso || '')).getTime();
  const hours = Number(durationHours);
  if (!Number.isFinite(startMs) || !Number.isFinite(hours) || hours <= 0) return null;
  return new Date(startMs + hours * 60 * 60 * 1000).toISOString();
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
  resolveCharterDurationHours,
  charterEndIsoFromStart,
};
