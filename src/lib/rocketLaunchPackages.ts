/**
 * Presentation-only mirror of server rocket launch packages.
 * Checkout amounts and guest counts are enforced on the server — never send prices in URLs.
 */

export type RocketPackageId = 'rocket_solo' | 'rocket_duo' | 'rocket_private';

export type RocketPackageDisplay = {
  id: RocketPackageId;
  cardTitle: string;
  guestCount: number;
  maxGuests?: number;
  directPriceUsd: number;
  perGuestUsd: number;
  seating: 'shared' | 'private';
  badge: string | null;
  ctaLabel: string;
  included: readonly string[];
};

/** Operational minimum for shared rocket departures — keep aligned with server config when Slice C lands. */
export const ROCKET_LAUNCH_MIN_GUESTS = 4;

/** Must stay aligned with server/config/rocketLaunchPackages.js */
export const ROCKET_PACKAGE_DISPLAY: RocketPackageDisplay[] = [
  {
    id: 'rocket_solo',
    cardTitle: 'Solo Rocket Launch Seat',
    guestCount: 1,
    directPriceUsd: 100,
    perGuestUsd: 100,
    seating: 'shared',
    badge: null,
    ctaLabel: 'Select Solo Seat',
    included: ['Captain included', 'Fuel included', 'Shared departure'],
  },
  {
    id: 'rocket_duo',
    cardTitle: 'Rocket Launch Duo',
    guestCount: 2,
    directPriceUsd: 190,
    perGuestUsd: 95,
    seating: 'shared',
    badge: null,
    ctaLabel: 'Select Duo Package',
    included: ['Captain included', 'Fuel included', 'Shared departure · 2 seats'],
  },
  {
    id: 'rocket_private',
    cardTitle: 'Private Rocket Launch Charter',
    guestCount: 5,
    maxGuests: 5,
    directPriceUsd: 450,
    perGuestUsd: 450,
    seating: 'private',
    badge: 'Entire boat',
    ctaLabel: 'Select Private Charter',
    included: ['Captain included', 'Fuel included', 'Up to 5 guests · No shared minimum'],
  },
];

/**
 * Mirrors server flag: package UI/checkout only when VITE_DIRECT_ROCKET_PACKAGE_PRICING_ENABLED=true.
 * Missing or any other value keeps legacy $85×guests rocket pricing in BookNow.
 */
export function isDirectRocketPackagePricingEnabled(): boolean {
  return import.meta.env.VITE_DIRECT_ROCKET_PACKAGE_PRICING_ENABLED === 'true';
}

export function isRocketLaunchPackageId(id: string | null | undefined): boolean {
  const key = String(id || '').trim();
  return key.startsWith('rocket_') && ROCKET_PACKAGE_DISPLAY.some((p) => p.id === key);
}

export function getRocketPackageDisplay(id: string | null | undefined): RocketPackageDisplay | null {
  const key = String(id || '').trim() as RocketPackageId;
  return ROCKET_PACKAGE_DISPLAY.find((p) => p.id === key) ?? null;
}

export function rocketBookingUrl(packageId: RocketPackageId): string {
  return `/booking?bookingMode=charter&charterType=rocket&package=${encodeURIComponent(packageId)}`;
}

export const ROCKET_SHARED_CHARTER_DISCLOSURE =
  'Your seats are reserved on a shared rocket launch charter. This trip requires a minimum number of booked guests before the departure is fully confirmed. If the minimum is not reached, Launch Zone Charters will contact you regarding your available options.';

export const ROCKET_DUO_EXTRA_DISCLOSURE =
  'Your two seats are reserved, but additional guests may still be required before the charter can operate.';

export const ROCKET_PRIVATE_CHARTER_DESCRIPTION =
  'Reserve the entire boat for your group of up to 5 guests. No shared-charter minimum applies.';

export const ROCKET_SCHEDULE_NOTICE =
  'Rocket launch dates and times may change due to weather, technical issues, or decisions made by the launch provider. Launch Zone Charters does not control the launch schedule. If a launch is delayed, scrubbed, or rescheduled, affected guests will be contacted regarding available options.';

export const ROCKET_SHARED_ACK_LABEL =
  'I understand this is a shared charter and the trip must reach the minimum guest requirement before departure is fully confirmed.';

export function formatRocketDepartureSlotLabel(summary: {
  guestsBooked: number;
  guestsMax: number;
  guestsNeededForMinimum: number;
  minimumReached: boolean;
  seatsRemaining: number;
  privateCharter?: boolean;
} | null | undefined): string | null {
  if (!summary) return null;
  if (summary.privateCharter) return 'Private charter — fully reserved';
  if (summary.guestsBooked >= summary.guestsMax) return 'Sold out';
  if (summary.minimumReached) {
    return `${summary.guestsBooked} of ${summary.guestsMax} seats · Minimum reached · ${summary.seatsRemaining} remaining`;
  }
  return `${summary.guestsBooked} of ${summary.guestsMax} seats · ${summary.guestsNeededForMinimum} more guest${summary.guestsNeededForMinimum === 1 ? '' : 's'} needed`;
}

export type RocketDepartureStatus = 'awaiting_minimum' | 'departure_confirmed' | 'departure_full';

export function rocketDepartureStatusLabel(status: string | null | undefined): string {
  switch (String(status || '').trim()) {
    case 'awaiting_minimum':
      return 'Awaiting minimum guests';
    case 'departure_confirmed':
      return 'Departure confirmed';
    case 'departure_full':
      return 'Departure full';
    default:
      return 'Unknown';
  }
}

export function rocketDepartureStatusBadgeClass(status: string | null | undefined): string {
  switch (String(status || '').trim()) {
    case 'awaiting_minimum':
      return 'bg-amber-100 text-amber-900';
    case 'departure_confirmed':
      return 'bg-emerald-100 text-emerald-900';
    case 'departure_full':
      return 'bg-slate-200 text-slate-800';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export type AdminRocketDepartureGroupBooking = {
  id: string;
  status: string;
  guestCount: number;
  packageName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  departureConfirmationStatus: string | null;
};

export type AdminRocketDepartureDetail = {
  applicable: boolean;
  privateCharter?: boolean;
  legacyBooking?: boolean;
  sharedDepartureId?: string;
  departureStatus?: RocketDepartureStatus | string | null;
  computedStatus?: RocketDepartureStatus | string | null;
  staffOverridden?: boolean;
  summary?: {
    guestsBooked: number;
    guestsMax: number;
    minimumGuests: number;
    guestsNeededForMinimum: number;
    minimumReached: boolean;
    seatsRemaining: number;
    departureStatus: RocketDepartureStatus;
  };
  label?: string | null;
  canForceConfirm?: boolean;
  canRevertToComputed?: boolean;
  bookings?: AdminRocketDepartureGroupBooking[];
};

export function formatRocketPackagePriceUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export function isSharedRocketPackage(pkg: RocketPackageDisplay | null | undefined): boolean {
  return Boolean(pkg && pkg.seating === 'shared');
}

/** Admin staff booking — labels must match server package prices. */
export const ROCKET_STAFF_PACKAGE_OPTIONS = ROCKET_PACKAGE_DISPLAY.map((p) => ({
  id: p.id,
  label: `${p.cardTitle} — ${formatRocketPackagePriceUsd(p.directPriceUsd)}`,
  guestCount: p.id === 'rocket_private' ? null : p.guestCount,
  directPriceUsd: p.directPriceUsd,
  seating: p.seating,
}));
