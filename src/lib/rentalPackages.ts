/**
 * Presentation + client validation mirror of server/config/rentalPackages.js.
 * Stripe amounts are enforced on the server — never trust browser-supplied prices.
 *
 * Pontoon and Key Largo center console share 4h/6h structure; prices differ by
 * stable boat UUID (see DEFAULT_*_BOAT_IDS).
 */

export const RENTAL_BUSINESS_TZ = 'America/New_York';
export const RENTAL_OPEN_HOUR = 6;
export const RENTAL_CLOSE_HOUR = 17;
export const RENTAL_SLOT_STEP_MINUTES = 60;
export const RENTAL_MAX_PASSENGERS = 6;

export type RentalPackageId = 'rental_4hr' | 'rental_6hr';
export type RentalFleet = 'pontoon' | 'center_console';

/** Production boat UUIDs — keep in sync with server/config/rentalPackages.js */
export const RENTAL_PONTOON_BOAT_IDS = ['a68bdf6b-be8d-48ad-971a-ac1854eb45da'] as const;
export const RENTAL_CENTER_CONSOLE_BOAT_IDS = ['8847383e-0f4a-4b82-b3dd-e7c0133e3a97'] as const;

export type RentalPackageDisplay = {
  id: RentalPackageId;
  name: string;
  durationHours: 4 | 6;
  priceCents: number;
  priceUsd: number;
  rentalType: 'half_day' | 'hourly';
  maxPassengers: number;
  label: string;
  fleet: RentalFleet;
};

const FLEET_PRICE_CENTS: Record<RentalFleet, Record<4 | 6, number>> = {
  pontoon: { 4: 14999, 6: 20999 },
  center_console: { 4: 29999, 6: 44999 },
};

const FLEET_LABEL: Record<RentalFleet, string> = {
  pontoon: 'Pontoon',
  center_console: 'Center Console',
};

const PACKAGE_DEFS: Array<{
  id: RentalPackageId;
  durationHours: 4 | 6;
  rentalType: 'half_day' | 'hourly';
}> = [
  { id: 'rental_4hr', durationHours: 4, rentalType: 'half_day' },
  { id: 'rental_6hr', durationHours: 6, rentalType: 'hourly' },
];

function packageForFleet(
  def: (typeof PACKAGE_DEFS)[number],
  fleet: RentalFleet
): RentalPackageDisplay {
  const priceCents = FLEET_PRICE_CENTS[fleet][def.durationHours];
  const priceUsd = priceCents / 100;
  const labelName = FLEET_LABEL[fleet];
  return {
    id: def.id,
    name: `${def.durationHours}-Hour ${labelName} Rental`,
    durationHours: def.durationHours,
    priceCents,
    priceUsd,
    rentalType: def.rentalType,
    maxPassengers: RENTAL_MAX_PASSENGERS,
    label: `${def.durationHours} Hours — $${priceUsd.toFixed(2)}`,
    fleet,
  };
}

export function resolveRentalFleet(boat?: {
  id?: string | null;
  name?: string | null;
} | null): RentalFleet {
  const id = String(boat?.id || '')
    .trim()
    .toLowerCase();
  if (id && RENTAL_CENTER_CONSOLE_BOAT_IDS.some((x) => x.toLowerCase() === id)) {
    return 'center_console';
  }
  if (id && RENTAL_PONTOON_BOAT_IDS.some((x) => x.toLowerCase() === id)) {
    return 'pontoon';
  }
  const name = String(boat?.name || '').toLowerCase();
  if (/key\s*largo|center\s*console/.test(name)) return 'center_console';
  return 'pontoon';
}

export function listRentalPackagesForBoat(boat?: {
  id?: string | null;
  name?: string | null;
} | null): RentalPackageDisplay[] {
  const fleet = resolveRentalFleet(boat);
  return PACKAGE_DEFS.map((def) => packageForFleet(def, fleet));
}

/** Default pontoon package list (Pricing pontoon card, legacy imports). */
export const RENTAL_PACKAGES: Record<RentalPackageId, RentalPackageDisplay> = {
  rental_4hr: packageForFleet(PACKAGE_DEFS[0], 'pontoon'),
  rental_6hr: packageForFleet(PACKAGE_DEFS[1], 'pontoon'),
};

export const RENTAL_PACKAGE_LIST: readonly RentalPackageDisplay[] = [
  RENTAL_PACKAGES.rental_4hr,
  RENTAL_PACKAGES.rental_6hr,
];

export const CENTER_CONSOLE_RENTAL_PACKAGE_LIST: readonly RentalPackageDisplay[] =
  listRentalPackagesForBoat({ id: RENTAL_CENTER_CONSOLE_BOAT_IDS[0] });

export function getRentalPackage(
  packageId: string | null | undefined,
  boat?: { id?: string | null; name?: string | null } | null
): RentalPackageDisplay | null {
  const id = String(packageId || '').trim();
  if (id !== 'rental_4hr' && id !== 'rental_6hr') return null;
  const fleet = resolveRentalFleet(boat);
  const def = PACKAGE_DEFS.find((p) => p.id === id);
  return def ? packageForFleet(def, fleet) : null;
}

export function getRentalPackageByDuration(
  hours: number,
  boat?: { id?: string | null; name?: string | null } | null
): RentalPackageDisplay | null {
  const fleet = resolveRentalFleet(boat);
  if (Math.abs(hours - 4) < 0.01) return packageForFleet(PACKAGE_DEFS[0], fleet);
  if (Math.abs(hours - 6) < 0.01) return packageForFleet(PACKAGE_DEFS[1], fleet);
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
