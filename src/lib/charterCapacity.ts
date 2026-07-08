/** Captain-led charter capacity: passengers + captain aboard. */
export const CHARTER_MAX_PASSENGERS = 5;
export const CHARTER_CAPTAIN_COUNT = 1;
export const CHARTER_MAX_TOTAL_ABOARD = CHARTER_MAX_PASSENGERS + CHARTER_CAPTAIN_COUNT;
export const CHARTER_MIN_PASSENGERS = 1;

export function isCaptainLedCharter(booking: { booking_type?: string | null }): boolean {
  return booking.booking_type === 'charter';
}

export function adminCharterCapacityLines(passengerCount: number) {
  const passengers = Math.max(0, Math.floor(Number(passengerCount) || 0));
  const total = passengers + CHARTER_CAPTAIN_COUNT;
  return {
    passengerLine: `Passenger count: ${passengers} / ${CHARTER_MAX_PASSENGERS}`,
    captainLine: `Captain: ${CHARTER_CAPTAIN_COUNT}`,
    totalLine: `Total aboard: ${total} / ${CHARTER_MAX_TOTAL_ABOARD}`,
  };
}

export function validateCharterPassengerCount(rawCount: unknown): { valid: true; count: number } | { valid: false; error: string } {
  const count = Math.floor(Number(rawCount));
  if (!Number.isFinite(count) || count < CHARTER_MIN_PASSENGERS) {
    return { valid: false, error: `Select ${CHARTER_MIN_PASSENGERS}–${CHARTER_MAX_PASSENGERS} passengers.` };
  }
  if (count > CHARTER_MAX_PASSENGERS) {
    return {
      valid: false,
      error: `Charter bookings allow up to ${CHARTER_MAX_PASSENGERS} passengers (plus captain).`,
    };
  }
  return { valid: true, count };
}
