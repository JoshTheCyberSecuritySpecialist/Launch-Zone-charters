/**
 * Presentation + client validation mirror of server/config/rentalPackages.js.
 * Stripe amounts are enforced on the server — never trust browser-supplied prices.
 */

export const RENTAL_BUSINESS_TZ = 'America/New_York';
export const RENTAL_OPEN_HOUR = 6;
export const RENTAL_CLOSE_HOUR = 17;
export const RENTAL_SLOT_STEP_MINUTES = 60;
export const RENTAL_MAX_PASSENGERS = 6;

export type RentalPackageId = 'rental_4hr' | 'rental_6hr';

export type RentalPackageDisplay = {
  id: RentalPackageId;
  name: string;
  durationHours: 4 | 6;
  priceCents: number;
  priceUsd: number;
  rentalType: 'half_day' | 'hourly';
  maxPassengers: number;
  label: string;
};

export const RENTAL_PACKAGES: Record<RentalPackageId, RentalPackageDisplay> = {
  rental_4hr: {
    id: 'rental_4hr',
    name: '4-Hour Pontoon Rental',
    durationHours: 4,
    priceCents: 14999,
    priceUsd: 149.99,
    rentalType: 'half_day',
    maxPassengers: RENTAL_MAX_PASSENGERS,
    label: '4 Hours — $149.99',
  },
  rental_6hr: {
    id: 'rental_6hr',
    name: '6-Hour Pontoon Rental',
    durationHours: 6,
    priceCents: 20999,
    priceUsd: 209.99,
    rentalType: 'hourly',
    maxPassengers: RENTAL_MAX_PASSENGERS,
    label: '6 Hours — $209.99',
  },
};

export const RENTAL_PACKAGE_LIST: readonly RentalPackageDisplay[] = [
  RENTAL_PACKAGES.rental_4hr,
  RENTAL_PACKAGES.rental_6hr,
];

export function getRentalPackage(packageId: string | null | undefined): RentalPackageDisplay | null {
  const id = String(packageId || '').trim();
  if (id === 'rental_4hr' || id === 'rental_6hr') return RENTAL_PACKAGES[id];
  return null;
}

export function getRentalPackageByDuration(hours: number): RentalPackageDisplay | null {
  if (Math.abs(hours - 4) < 0.01) return RENTAL_PACKAGES.rental_4hr;
  if (Math.abs(hours - 6) < 0.01) return RENTAL_PACKAGES.rental_6hr;
  return null;
}

export function formatRentalMoney(amount: number): string {
  return `$${Number(amount).toFixed(2)}`;
}

/** Format a slot end label from start ISO + duration hours (local display). */
export function formatRentalSlotRangeLabel(startIso: string, durationHours: number, startLabel?: string): string {
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime())) return startLabel || '';
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const startText = startLabel || start.toLocaleTimeString(undefined, opts);
  const endText = end.toLocaleTimeString(undefined, opts);
  return `${startText} – ${endText}`;
}
