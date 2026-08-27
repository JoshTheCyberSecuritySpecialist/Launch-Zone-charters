/**
 * Presentation-only mirror of server sunset packages.
 * Checkout amounts and guest counts are enforced on the server — never send prices in URLs.
 */

export type SunsetPackageId = 'sunset_solo' | 'sunset_two' | 'sunset_three' | 'sunset_family' | 'sunset_private';

export type SunsetPackageDisplay = {
  id: SunsetPackageId;
  cardTitle: string;
  guestCount: number;
  maxGuests?: number;
  directPriceUsd: number;
  listPriceUsd: number;
  perGuestUsd: number;
  seating: 'shared' | 'private';
  canOpenSharedDeparture: boolean;
  badge: string | null;
  ctaLabel: string;
  included: readonly string[];
};

/** Must stay aligned with server/config/sunsetPackages.js */
export const SUNSET_PACKAGE_DISPLAY: SunsetPackageDisplay[] = [
  {
    id: 'sunset_solo',
    cardTitle: 'Sunset Solo Seat',
    guestCount: 1,
    directPriceUsd: 75,
    listPriceUsd: 85,
    perGuestUsd: 75,
    seating: 'shared',
    canOpenSharedDeparture: false,
    badge: null,
    ctaLabel: 'Select Solo Seat',
    included: ['Captain included', 'Fuel included', 'Joins an open shared sunset'],
  },
  {
    id: 'sunset_two',
    cardTitle: 'Sunset for Two',
    guestCount: 2,
    directPriceUsd: 140,
    listPriceUsd: 160,
    perGuestUsd: 70,
    seating: 'shared',
    canOpenSharedDeparture: true,
    badge: null,
    ctaLabel: 'Select Sunset for Two',
    included: ['Captain included', 'Fuel included', 'Opens a shared sunset departure'],
  },
  {
    id: 'sunset_three',
    cardTitle: 'Sunset for Three',
    guestCount: 3,
    directPriceUsd: 210,
    listPriceUsd: 240,
    perGuestUsd: 70,
    seating: 'shared',
    canOpenSharedDeparture: true,
    badge: null,
    ctaLabel: 'Select Sunset for Three',
    included: ['Captain included', 'Fuel included', 'Opens a shared sunset departure'],
  },
  {
    id: 'sunset_family',
    cardTitle: 'Sunset Family',
    guestCount: 1,
    maxGuests: 5,
    directPriceUsd: 250,
    listPriceUsd: 285,
    perGuestUsd: 250,
    seating: 'private',
    canOpenSharedDeparture: false,
    badge: 'Private boat',
    ctaLabel: 'Select Family Charter',
    included: ['Captain included', 'Fuel included', 'Up to 5 guests · Exclusive boat'],
  },
  {
    id: 'sunset_private',
    cardTitle: 'Private Sunset Charter',
    guestCount: 1,
    maxGuests: 5,
    directPriceUsd: 325,
    listPriceUsd: 375,
    perGuestUsd: 325,
    seating: 'private',
    canOpenSharedDeparture: false,
    badge: 'Entire boat',
    ctaLabel: 'Select Private Charter',
    included: ['Captain included', 'Fuel included', 'Up to 5 guests · Exclusive boat'],
  },
];

/**
 * Mirrors server flag: package UI/checkout only when VITE_DIRECT_SUNSET_PACKAGE_PRICING_ENABLED=true.
 * Missing or any other value keeps legacy $75×guests sunset pricing in BookNow.
 */
export function isDirectSunsetPackagePricingEnabled(): boolean {
  return import.meta.env.VITE_DIRECT_SUNSET_PACKAGE_PRICING_ENABLED === 'true';
}

export function isSunsetPackageId(id: string | null | undefined): boolean {
  const key = String(id || '').trim();
  return key.startsWith('sunset_') && SUNSET_PACKAGE_DISPLAY.some((p) => p.id === key);
}

export function getSunsetPackageDisplay(id: string | null | undefined): SunsetPackageDisplay | null {
  const key = String(id || '').trim() as SunsetPackageId;
  return SUNSET_PACKAGE_DISPLAY.find((p) => p.id === key) ?? null;
}

export function sunsetBookingUrl(packageId: SunsetPackageId): string {
  return `/booking?bookingMode=charter&charterType=sunset&package=${encodeURIComponent(packageId)}`;
}

export const SUNSET_SOLO_NO_DEPARTURE_MESSAGE =
  'No shared sunset departure is open for this time yet. You can choose another shared departure, book Sunset for Two or Three, or book a private sunset experience.';

export const SUNSET_SOLO_JOIN_DISCLOSURE =
  'A solo seat can only join a shared sunset that is already booked and paid. If none is open, book Sunset for Two or Three to start a departure, or choose a private sunset.';

export const SUNSET_TWO_OPENER_DISCLOSURE =
  'This package opens a shared sunset departure. Remaining seats may be booked by other guests until the boat is full.';

export const SUNSET_PRIVATE_CHARTER_DESCRIPTION =
  'Reserve the boat for your group. This is a private sunset — other guests will not join your trip.';

export const SUNSET_WILDLIFE_DISCLAIMER =
  'Dolphins and other wildlife may be seen but are never guaranteed.';

export function formatSunsetPackagePriceUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export function isSharedSunsetPackage(pkg: SunsetPackageDisplay | null | undefined): boolean {
  return Boolean(pkg && pkg.seating === 'shared');
}

/** Admin staff booking — labels must match server package prices. */
export const SUNSET_STAFF_PACKAGE_OPTIONS = SUNSET_PACKAGE_DISPLAY.map((p) => ({
  id: p.id,
  label: `${p.cardTitle} — ${formatSunsetPackagePriceUsd(p.directPriceUsd)}`,
  guestCount: p.seating === 'private' ? null : p.guestCount,
  maxGuests: p.maxGuests ?? p.guestCount,
  directPriceUsd: p.directPriceUsd,
  listPriceUsd: p.listPriceUsd,
  seating: p.seating,
}));
