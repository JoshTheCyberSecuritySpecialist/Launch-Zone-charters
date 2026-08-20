/**
 * Direct-deals landing cards.
 * Prices, guest counts, and booking URLs come from existing package/experience modules.
 * Do not add independent dollar amounts here.
 */
import {
  BIO_PACKAGE_DISPLAY,
  bioBookingUrl,
  formatBioPackagePriceUsd,
  type BioPackageDisplay,
} from './bioluminescencePackages';
import {
  EXPERIENCE_BIO,
  EXPERIENCE_ROCKET,
  EXPERIENCE_SUNSET,
} from './experienceCatalog';
import {
  ROCKET_DUO_EXTRA_DISCLOSURE,
  ROCKET_PACKAGE_DISPLAY,
  ROCKET_PRIVATE_CHARTER_DESCRIPTION,
  ROCKET_SHARED_CHARTER_DISCLOSURE,
  rocketBookingUrl,
  formatRocketPackagePriceUsd,
  type RocketPackageDisplay,
} from './rocketLaunchPackages';
import {
  SUNSET_PACKAGE_DISPLAY,
  SUNSET_PRIVATE_CHARTER_DESCRIPTION,
  SUNSET_SOLO_JOIN_DISCLOSURE,
  SUNSET_TWO_OPENER_DISCLOSURE,
  sunsetBookingUrl,
  formatSunsetPackagePriceUsd,
  type SunsetPackageDisplay,
} from './sunsetPackages';

export const DIRECT_DEALS_PATH = '/booking/direct';

const BIO_CHARTER_BOOKING_URL = '/booking?bookingMode=charter&charterType=bio';

export type DirectDealExperienceId = 'bio' | 'rocket_launch' | 'sunset';

export type DirectDealSeating = 'shared' | 'private';

export type DirectDealDisclosureKind =
  | 'bio_shared'
  | 'rocket_shared'
  | 'rocket_private'
  | 'sunset_shared'
  | 'sunset_private'
  | 'none';

export type DirectDealCard = {
  id: string;
  experienceId: DirectDealExperienceId;
  packageId: string | null;
  name: string;
  description: string;
  guestLabel: string;
  seating: DirectDealSeating | null;
  seatingLabel: string;
  priceLabel: string | null;
  href: string;
  disclosure: DirectDealDisclosureKind;
  disclosureBody: string | null;
  extraDisclosure: string | null;
  badge: string | null;
};

export type DirectDealSection = {
  id: 'bio' | 'rocket' | 'sunset';
  heading: string;
  cards: DirectDealCard[];
};

export type DirectDealFlags = {
  bioPackagesEnabled: boolean;
  rocketPackagesEnabled: boolean;
  sunsetPackagesEnabled: boolean;
};

function guestCountLabel(count: number): string {
  return count === 1 ? '1 Guest' : `${count} Guests`;
}

function bioSkuCard(pkg: BioPackageDisplay): DirectDealCard {
  return {
    id: pkg.id,
    experienceId: 'bio',
    packageId: pkg.id,
    name: pkg.cardTitle,
    description: 'Nighttime bioluminescence boat tour',
    guestLabel: guestCountLabel(pkg.guestCount),
    seating: 'shared',
    seatingLabel: 'Shared Departure',
    priceLabel: formatBioPackagePriceUsd(pkg.directPriceUsd),
    href: bioBookingUrl(pkg.id),
    disclosure: 'bio_shared',
    disclosureBody:
      'This booking reserves your seats on a shared trip. Launch Zone Charters assigns your vessel — you do not pick a boat here.',
    extraDisclosure: null,
    badge: pkg.badge,
  };
}

function rocketSkuCard(pkg: RocketPackageDisplay): DirectDealCard {
  const isPrivate = pkg.seating === 'private';
  return {
    id: pkg.id,
    experienceId: 'rocket_launch',
    packageId: pkg.id,
    name: pkg.cardTitle,
    description: isPrivate
      ? ROCKET_PRIVATE_CHARTER_DESCRIPTION
      : EXPERIENCE_ROCKET.tagline,
    guestLabel: isPrivate ? 'Up to 5 Guests' : guestCountLabel(pkg.guestCount),
    seating: pkg.seating,
    seatingLabel: isPrivate ? 'Private Charter' : 'Shared Departure',
    priceLabel: formatRocketPackagePriceUsd(pkg.directPriceUsd),
    href: rocketBookingUrl(pkg.id),
    disclosure: isPrivate ? 'rocket_private' : 'rocket_shared',
    disclosureBody: isPrivate ? null : ROCKET_SHARED_CHARTER_DISCLOSURE,
    extraDisclosure: pkg.id === 'rocket_duo' ? ROCKET_DUO_EXTRA_DISCLOSURE : null,
    badge: isPrivate ? 'Private Charter' : pkg.badge,
  };
}

function bioFallbackCard(): DirectDealCard {
  return {
    id: 'bio_charter',
    experienceId: 'bio',
    packageId: null,
    name: EXPERIENCE_BIO.publicName,
    description: 'Nighttime bioluminescence boat tour',
    guestLabel: 'Choose guests in booking',
    seating: 'shared',
    seatingLabel: 'Shared Departure',
    priceLabel: null,
    href: BIO_CHARTER_BOOKING_URL,
    disclosure: 'bio_shared',
    disclosureBody:
      'This booking reserves your seats on a shared trip. Launch Zone Charters assigns your vessel — you do not pick a boat here.',
    extraDisclosure: null,
    badge: null,
  };
}

function rocketFallbackCard(): DirectDealCard {
  return {
    id: 'rocket_charter',
    experienceId: 'rocket_launch',
    packageId: null,
    name: EXPERIENCE_ROCKET.publicName,
    description: EXPERIENCE_ROCKET.tagline,
    guestLabel: 'Choose guests in booking',
    seating: null,
    seatingLabel: 'Captain-led charter',
    priceLabel: null,
    href: EXPERIENCE_ROCKET.bookingUrl,
    disclosure: 'none',
    disclosureBody: null,
    extraDisclosure: null,
    badge: null,
  };
}

function sunsetSkuCard(pkg: SunsetPackageDisplay): DirectDealCard {
  const isPrivate = pkg.seating === 'private';
  return {
    id: pkg.id,
    experienceId: 'sunset',
    packageId: pkg.id,
    name: pkg.cardTitle,
    description: isPrivate ? SUNSET_PRIVATE_CHARTER_DESCRIPTION : 'Relaxed captain-led cruise.',
    guestLabel: isPrivate ? `Up to ${pkg.maxGuests ?? 5} Guests` : guestCountLabel(pkg.guestCount),
    seating: pkg.seating,
    seatingLabel: isPrivate ? 'Private Charter' : 'Shared Departure',
    priceLabel: formatSunsetPackagePriceUsd(pkg.directPriceUsd),
    href: sunsetBookingUrl(pkg.id),
    disclosure: isPrivate ? 'sunset_private' : 'sunset_shared',
    disclosureBody: isPrivate
      ? null
      : pkg.id === 'sunset_solo'
        ? SUNSET_SOLO_JOIN_DISCLOSURE
        : SUNSET_TWO_OPENER_DISCLOSURE,
    extraDisclosure: null,
    badge: isPrivate ? 'Private Charter' : pkg.badge,
  };
}

function sunsetCard(): DirectDealCard {
  return {
    id: 'sunset_charter',
    experienceId: 'sunset',
    packageId: null,
    name: EXPERIENCE_SUNSET.publicName,
    description: 'Relaxed captain-led cruise.',
    guestLabel: 'Choose guests in booking',
    seating: null,
    seatingLabel: 'Captain-led charter',
    priceLabel: null,
    href: EXPERIENCE_SUNSET.bookingUrl,
    disclosure: 'none',
    // Section heading already prints the wildlife disclaimer.
    disclosureBody: null,
    extraDisclosure: null,
    badge: null,
  };
}

export function buildDirectDealSections(flags: DirectDealFlags): DirectDealSection[] {
  const bioCards = flags.bioPackagesEnabled
    ? BIO_PACKAGE_DISPLAY.map(bioSkuCard)
    : [bioFallbackCard()];
  const rocketCards = flags.rocketPackagesEnabled
    ? ROCKET_PACKAGE_DISPLAY.map(rocketSkuCard)
    : [rocketFallbackCard()];
  const sunsetCards = flags.sunsetPackagesEnabled
    ? SUNSET_PACKAGE_DISPLAY.map(sunsetSkuCard)
    : [sunsetCard()];

  return [
    { id: 'bio', heading: 'Bioluminescence Tours', cards: bioCards },
    { id: 'rocket', heading: 'Rocket Launch Experiences', cards: rocketCards },
    { id: 'sunset', heading: 'Sunset and Wildlife', cards: sunsetCards },
  ];
}

export function isKnownDirectPackageId(packageId: string | null | undefined): boolean {
  const id = String(packageId || '').trim();
  if (!id) return false;
  return (
    BIO_PACKAGE_DISPLAY.some((pkg) => pkg.id === id) ||
    ROCKET_PACKAGE_DISPLAY.some((pkg) => pkg.id === id) ||
    SUNSET_PACKAGE_DISPLAY.some((pkg) => pkg.id === id)
  );
}
