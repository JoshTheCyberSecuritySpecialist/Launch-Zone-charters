/**
 * Presentation-only mirror of server Dolphin & Wildlife Tour packages
 * (route key remains charterType=sunset).
 * Checkout amounts and guest counts are enforced on the server — never send prices in URLs.
 */

export const SUNSET_PACKAGE_DURATION_MINUTES = 120;

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
  description?: string;
  durationMinutes: number;
};

/** Must stay aligned with server/config/sunsetPackages.js */
export const SUNSET_PACKAGE_DISPLAY: SunsetPackageDisplay[] = [
  {
    id: 'sunset_solo',
    cardTitle: 'Dolphin & Wildlife Solo Seat',
    guestCount: 1,
    directPriceUsd: 39,
    listPriceUsd: 49,
    perGuestUsd: 39,
    seating: 'shared',
    canOpenSharedDeparture: false,
    badge: null,
    ctaLabel: 'Select Solo Seat',
    included: ['Captain included', 'Fuel included', 'Joins an open shared departure'],
    description:
      'One shared seat on a two-hour tour. Joins an existing paid shared departure only.',
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
  },
  {
    id: 'sunset_two',
    cardTitle: 'Dolphin & Wildlife Tour for Two',
    guestCount: 2,
    directPriceUsd: 75,
    listPriceUsd: 89,
    perGuestUsd: 37.5,
    seating: 'shared',
    canOpenSharedDeparture: true,
    badge: null,
    ctaLabel: 'Select Tour for Two',
    included: ['Captain included', 'Fuel included', 'Opens a shared departure'],
    description: 'Two-guest shared tour. Opens a shared departure for others to join.',
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
  },
  {
    id: 'sunset_three',
    cardTitle: 'Dolphin & Wildlife Tour for Three',
    guestCount: 3,
    directPriceUsd: 110,
    listPriceUsd: 129,
    perGuestUsd: Math.round((110 / 3) * 100) / 100,
    seating: 'shared',
    canOpenSharedDeparture: true,
    badge: null,
    ctaLabel: 'Select Tour for Three',
    included: ['Captain included', 'Fuel included', 'Opens a shared departure'],
    description: 'Three-guest shared tour. Opens a shared departure for others to join.',
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
  },
  {
    id: 'sunset_family',
    cardTitle: 'Private Dolphin & Wildlife Tour for Four',
    guestCount: 1,
    maxGuests: 4,
    directPriceUsd: 145,
    listPriceUsd: 169,
    perGuestUsd: 145,
    seating: 'private',
    canOpenSharedDeparture: false,
    badge: 'Private boat',
    ctaLabel: 'Select Private for Four',
    included: ['Captain included', 'Fuel included', 'Up to 4 guests · Exclusive boat'],
    description: 'Private two-hour tour for up to four guests. Entire boat reserved.',
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
  },
  {
    id: 'sunset_private',
    cardTitle: 'Private Dolphin & Wildlife Tour',
    guestCount: 1,
    maxGuests: 5,
    directPriceUsd: 179,
    listPriceUsd: 209,
    perGuestUsd: 179,
    seating: 'private',
    canOpenSharedDeparture: false,
    badge: 'Entire boat',
    ctaLabel: 'Select Private Tour',
    included: ['Captain included', 'Fuel included', 'Up to 5 guests · Exclusive boat'],
    description: 'Private two-hour tour for up to five guests. Entire boat reserved.',
    durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES,
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

/** Page copy for /booking/direct?experience=sunset and Book Now package step. */
export const SUNSET_TOUR_PAGE = {
  title: 'Dolphin & Wildlife Tour',
  chooseHeading: 'Choose your package',
  supportingText:
    "Explore Florida's Space Coast on a relaxing two-hour captain-led boat tour with opportunities to spot dolphins, manatees, coastal birds, and other local wildlife.",
  wildlifeNotice: 'Wildlife sightings are common but are never guaranteed.',
  directBookingMessage:
    'Book directly and save compared with our standard Groupon deal prices. No voucher required.',
  vesselNote: 'Guest packages — not boats. Launch Zone assigns your vessel based on availability.',
} as const;

export const SUNSET_SOLO_NO_DEPARTURE_MESSAGE =
  'No shared Dolphin & Wildlife departure is open for this time yet. You can choose another shared departure, book Tour for Two or Three, or book a private tour.';

export const SUNSET_SOLO_JOIN_DISCLOSURE =
  'A solo seat can only join a shared tour that is already booked and paid. If none is open, book Tour for Two or Three to start a departure, or choose a private tour.';

export const SUNSET_TWO_OPENER_DISCLOSURE =
  'This package opens a shared Dolphin & Wildlife departure. Remaining seats may be booked by other guests until the boat is full.';

export const SUNSET_PRIVATE_CHARTER_DESCRIPTION =
  'Reserve the boat for your group. This is a private tour — other guests will not join your trip.';

export const SUNSET_WILDLIFE_DISCLAIMER = SUNSET_TOUR_PAGE.wildlifeNotice;

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
