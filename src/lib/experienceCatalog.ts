/**
 * Customer-facing experience definitions (presentation only).
 * Booking URLs match BookNow searchParams; do not add pricing math here.
 */
import { CHARTER_MAX_PASSENGERS } from './charterCapacity';

export type ExperienceKind = 'captain-led' | 'self-drive';

export type CharterExperienceId = 'bio' | 'rocket_launch' | 'sunset';

export type CaptainLedExperience = {
  id: CharterExperienceId;
  kind: 'captain-led';
  publicName: string;
  shortLabel: string;
  marketingUrl: string;
  bookingUrl: string;
  locationLabel: string;
  icon: string;
  bookCta: string;
  exploreCta: string;
  tagline: string;
  wildlifeDisclaimer?: string;
};

export type RentalExperience = {
  id: 'rental';
  kind: 'self-drive';
  publicName: string;
  shortLabel: string;
  marketingUrlDaytona: string;
  marketingUrlTitusville: string;
  bookingUrlDaytona: string;
  bookingUrlTitusville: string;
  locationLabel: string;
  icon: string;
  bookCta: string;
  exploreCta: string;
  tagline: string;
};

export type ExperienceCatalogEntry = CaptainLedExperience | RentalExperience;

export const CHARTER_GUEST_LIMIT_LABEL = `Up to ${CHARTER_MAX_PASSENGERS} guests plus the captain`;

export const EXPERIENCE_BIO: CaptainLedExperience = {
  id: 'bio',
  kind: 'captain-led',
  publicName: 'Bioluminescence Night Tour',
  shortLabel: 'Bioluminescence Tours',
  marketingUrl: '/bioluminescent-tours',
  bookingUrl: '/bioluminescent-tours#packages',
  locationLabel: 'Titusville · Indian River Lagoon',
  icon: '✨',
  bookCta: 'View Bioluminescence Packages',
  exploreCta: 'Explore Bioluminescence Tours',
  tagline: 'From $44.99 · packages for one, two, three, or four guests.',
};

export const EXPERIENCE_ROCKET: CaptainLedExperience = {
  id: 'rocket_launch',
  kind: 'captain-led',
  publicName: 'Rocket Launch Charter',
  shortLabel: 'Rocket Launch Charters',
  marketingUrl: '/launches',
  bookingUrl: '/booking?bookingMode=charter&charterType=rocket_launch',
  locationLabel: 'Titusville · Space Coast',
  icon: '🚀',
  bookCta: 'Book Rocket Launch Charter',
  exploreCta: 'View Rocket Launch Charters',
  tagline: 'Watch a launch from the water with a licensed captain.',
};

export const EXPERIENCE_SUNSET: CaptainLedExperience = {
  id: 'sunset',
  kind: 'captain-led',
  publicName: 'Sunset and Wildlife Cruise',
  shortLabel: 'Sunset and Wildlife Cruise',
  marketingUrl: '/experiences#sunset-wildlife',
  bookingUrl: '/booking?bookingMode=charter&charterType=sunset',
  locationLabel: 'Titusville · Indian River Lagoon',
  icon: '🌅',
  bookCta: 'Book Sunset and Wildlife Cruise',
  exploreCta: 'Explore Sunset and Wildlife Cruises',
  tagline: 'Relaxed captain-led cruise; dolphins and other wildlife may be seen but are never guaranteed.',
  wildlifeDisclaimer:
    'Dolphins and other wildlife may be seen but are never guaranteed.',
};

export const EXPERIENCE_RENTAL: RentalExperience = {
  id: 'rental',
  kind: 'self-drive',
  publicName: 'Self-Drive Boat Rental',
  shortLabel: 'Boat Rentals',
  marketingUrlDaytona: '/boat-rentals/daytona',
  marketingUrlTitusville: '/boat-rentals/titusville',
  bookingUrlDaytona: '/booking?bookingMode=rental&location=daytona',
  bookingUrlTitusville: '/booking?bookingMode=rental&location=titusville',
  locationLabel: 'Daytona, Port Orange & Titusville',
  icon: '⛵',
  bookCta: 'Rent a Boat',
  exploreCta: 'View Boat Rentals',
  tagline: 'Operate the vessel yourself; captain, deposit, and insurance rules apply.',
};

export const EXPERIENCE_CATALOG_ORDER: ExperienceCatalogEntry[] = [
  EXPERIENCE_BIO,
  EXPERIENCE_ROCKET,
  EXPERIENCE_SUNSET,
  EXPERIENCE_RENTAL,
];

export function bookingPageTitleFromSearchParams(params: URLSearchParams): string | null {
  const mode = params.get('bookingMode');
  const charterType = params.get('charterType');
  const location = params.get('location');

  if (mode === 'charter') {
    if (charterType === 'bio' || charterType === 'night_bio') {
      return 'Book Your Bioluminescence Night Tour';
    }
    if (charterType === 'rocket' || charterType === 'rocket_launch') {
      return 'Book Your Rocket Launch Charter';
    }
    if (charterType === 'sunset' || charterType === 'sunset_cruise') {
      return 'Book Your Sunset and Wildlife Cruise';
    }
  }
  if (mode === 'rental') {
    if (location === 'titusville') return 'Rent a Boat — Titusville';
    if (location === 'daytona') return 'Rent a Boat — Daytona and Port Orange';
  }
  return null;
}

export function hasProductBookingContext(params: URLSearchParams): boolean {
  return bookingPageTitleFromSearchParams(params) !== null;
}
