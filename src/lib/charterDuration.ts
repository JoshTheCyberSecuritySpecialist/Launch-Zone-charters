/**
 * Catalog duration for captain-led packages (display + variable-length SKUs).
 * Sunset / Dolphin & Wildlife packages use 120 minutes; bio and rocket default to 60.
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
