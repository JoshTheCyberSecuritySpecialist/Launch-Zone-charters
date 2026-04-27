/** Shared formatters for Launch Library 2 (Space Devs) timestamps on the client. */

export function formatLaunchCountdown(iso: string | null | undefined): string {
  if (!iso) return 'TBD';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'TBD';
  const diff = t - Date.now();
  if (diff <= 0) return 'Soon / window open';
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

export function formatLaunchDateTime(iso: string | null | undefined): string {
  if (!iso) return 'TBD';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function normalizeStatus(status: string | null | undefined): string {
  return String(status || '')
    .trim()
    .toLowerCase();
}

/** Launch Library status is considered confirmed only when exactly `Go`. */
export function isConfirmedLaunchStatus(status: string | null | undefined): boolean {
  return normalizeStatus(status) === 'go';
}

function launchPeriodLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'TBD';
  const hourParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(hourParts.find((p) => p.type === 'hour')?.value ?? 12);
  if (hour < 6) return 'Early Morning';
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Night';
}

function launchDateShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * Trust-first launch time: show exact timestamp only for confirmed "Go" launches.
 * Non-confirmed launches display a softer estimate to avoid false precision.
 */
export function formatLaunchDisplayTime(
  iso: string | null | undefined,
  status: string | null | undefined
): string {
  if (!iso) return 'Estimated: TBD';
  if (isConfirmedLaunchStatus(status)) {
    return formatLaunchDateTime(iso);
  }
  return `Estimated: ${launchDateShort(iso)} (${launchPeriodLabel(iso)})`;
}

/**
 * Marketing copy: frames schedule as a viewing window, not a guaranteed instant.
 * Prefer this over raw {@link formatLaunchDateTime} in customer-facing UI.
 */
export function formatBestViewingWindow(
  iso: string | null | undefined,
  status: string | null | undefined
): string {
  if (!iso) return 'Best viewing window: to be announced (schedules may shift)';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Best viewing window: to be announced (schedules may shift)';
  const inner = formatLaunchDisplayTime(iso, status);
  if (inner === 'Estimated: TBD') {
    return 'Best viewing window: to be announced (schedules may shift)';
  }
  return `Best viewing window — ${inner}`;
}

export type LaunchConfidence = 'High' | 'Medium' | 'Low';

/**
 * Confidence badge:
 * - High: confirmed "Go"
 * - Medium: unconfirmed but within 5 days
 * - Low: TBD / invalid / far out
 */
export function getLaunchConfidence(
  iso: string | null | undefined,
  status: string | null | undefined
): LaunchConfidence {
  if (isConfirmedLaunchStatus(status)) return 'High';
  if (!iso) return 'Low';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Low';
  const daysOut = (t - Date.now()) / 86400000;
  if (daysOut >= 0 && daysOut <= 5) return 'Medium';
  return 'Low';
}
