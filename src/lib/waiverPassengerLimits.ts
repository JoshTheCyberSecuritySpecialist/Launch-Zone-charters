export const MAX_GUEST_WEIGHT_LBS = 745;
export const MAX_CAPTAIN_LED_GUESTS = 5;
export const MAX_SINGLE_PASSENGER_WEIGHT_LBS = 500;

export const WEIGHT_LIMIT_MESSAGE =
  'The combined passenger weight is above the 745 lb safety limit. Please contact Launch Zone Charters so we can safely review your trip.';

export const COUNT_LIMIT_MESSAGE =
  'Captain-led trips are limited to 5 guests because the vessel carries 6 people total, including the captain.';

export function totalGuestWeightFromRows(
  passengers: Array<{ weight_lbs: string | number }>
): number {
  return passengers.reduce((total, row) => {
    const n = Number(String(row.weight_lbs || '').trim());
    return total + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

export function remainingGuestWeightLbs(totalGuestWeight: number): number {
  return Math.max(0, MAX_GUEST_WEIGHT_LBS - totalGuestWeight);
}

export function guestCountLimitExceeded(captainLed: boolean, guestCount: number): boolean {
  return captainLed && guestCount > MAX_CAPTAIN_LED_GUESTS;
}

export function guestWeightLimitExceeded(totalGuestWeight: number): boolean {
  return totalGuestWeight > MAX_GUEST_WEIGHT_LBS;
}
