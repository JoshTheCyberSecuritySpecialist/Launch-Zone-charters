/**
 * Catalog duration for captain-led packages (display + future variable-length SKUs).
 * Availability, overlap, and Stripe still use the existing 1-hour charter window
 * until variable-duration scheduling is enabled.
 */

export const DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES = 60;

export function normalizeCharterDurationMinutes(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES;
  return Math.round(n);
}

export function resolvePackageDurationMinutes(pkg: { durationMinutes?: number } | null | undefined): number {
  return normalizeCharterDurationMinutes(pkg?.durationMinutes);
}

/** 60 → "1 Hour", 90 → "1.5 Hours", 120 → "2 Hours" */
export function formatCharterDurationLabel(minutes?: unknown): string {
  const totalMinutes = normalizeCharterDurationMinutes(minutes);
  const hours = totalMinutes / 60;
  if (hours === 1) return '1 Hour';
  if (Number.isInteger(hours)) return `${hours} Hours`;
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} Hours`;
}

export function formatCharterDurationTourLabel(minutes?: unknown): string {
  return `${formatCharterDurationLabel(minutes)} Tour`;
}
