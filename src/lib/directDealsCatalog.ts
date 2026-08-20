/**
 * Direct-deals landing cards — one summary per experience.
 * Package SKUs are chosen on /booking/direct?experience=… then BookNow receives package=.
 */
import {
  BIO_PACKAGE_DISPLAY,
  formatBioPackagePriceUsd,
} from './bioluminescencePackages';
import { directExperienceChooserPath } from './directBookingFlow.js';
import {
  ROCKET_PACKAGE_DISPLAY,
  formatRocketPackagePriceUsd,
} from './rocketLaunchPackages';
import {
  SUNSET_PACKAGE_DISPLAY,
  formatSunsetPackagePriceUsd,
} from './sunsetPackages';

export { DIRECT_DEALS_PATH, directExperienceChooserPath, bookingUrlForDirectPackage, parseDirectExperienceParam } from './directBookingFlow.js';

export type DirectDealExperienceId = 'bio' | 'rocket_launch' | 'sunset';

export type DirectExperienceCard = {
  id: DirectDealExperienceId;
  category: string;
  name: string;
  description: string;
  supportingText: string;
  fromPriceLabel: string | null;
  ctaLabel: string;
  href: string;
};

export type DirectDealFlags = {
  bioPackagesEnabled: boolean;
  rocketPackagesEnabled: boolean;
  sunsetPackagesEnabled: boolean;
};

function lowestDirectPriceUsd(pkgs: ReadonlyArray<{ directPriceUsd: number }>): number | null {
  const values = pkgs
    .map((pkg) => Number(pkg.directPriceUsd))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!values.length) return null;
  return Math.min(...values);
}

function packagesFromLabel(amount: number | null, format: (n: number) => string): string | null {
  if (amount == null) return null;
  return `Packages from ${format(amount)}`;
}

export function buildDirectExperienceCards(flags: DirectDealFlags): DirectExperienceCard[] {
  const bioFrom = flags.bioPackagesEnabled
    ? packagesFromLabel(lowestDirectPriceUsd(BIO_PACKAGE_DISPLAY), formatBioPackagePriceUsd)
    : null;
  const rocketFrom = flags.rocketPackagesEnabled
    ? packagesFromLabel(lowestDirectPriceUsd(ROCKET_PACKAGE_DISPLAY), formatRocketPackagePriceUsd)
    : null;
  const sunsetFrom = flags.sunsetPackagesEnabled
    ? packagesFromLabel(lowestDirectPriceUsd(SUNSET_PACKAGE_DISPLAY), formatSunsetPackagePriceUsd)
    : null;

  return [
    {
      id: 'bio',
      category: 'Bioluminescence',
      name: 'Bioluminescence Night Tour',
      description: "See Florida's glowing waters on a captain-led nighttime boat tour.",
      supportingText: 'Shared packages available for individuals, couples, and groups.',
      fromPriceLabel: bioFrom,
      ctaLabel: 'View Bio Tours',
      href: directExperienceChooserPath('bio'),
    },
    {
      id: 'rocket_launch',
      category: 'Rocket Launch',
      name: 'Rocket Launch Experience',
      description: 'Watch a Space Coast rocket launch from the water with a licensed captain.',
      supportingText: 'Shared seats and private charter options available.',
      fromPriceLabel: rocketFrom,
      ctaLabel: 'View Rocket Options',
      href: directExperienceChooserPath('rocket'),
    },
    {
      id: 'sunset',
      category: 'Sunset & Wildlife',
      name: 'Sunset & Wildlife Cruise',
      description: 'Relax on the Indian River Lagoon while enjoying sunset views and local wildlife.',
      supportingText: 'Shared and private cruise options available.',
      fromPriceLabel: sunsetFrom,
      ctaLabel: 'View Sunset Options',
      href: directExperienceChooserPath('sunset'),
    },
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
