/**
 * Single source of truth for customer-facing fees that are not stored per boat.
 * Boat rental base rates come from `boats` (hourly / half-day / full-day).
 */
export const PRICING = {
  captainHourly: 50,
  securityDeposit: 300,
} as const;

/** Captain add-on: hourly rate × scheduled rental hours (all rental types). */
export function captainFeeForHours(hours: number): number {
  const h = Math.max(0, Number(hours) || 0);
  return Math.round(PRICING.captainHourly * h * 100) / 100;
}
