/**
 * Presentation-only mirror of server bioluminescence packages.
 * Checkout amounts and guest counts are enforced on the server — never send prices in URLs.
 */

export type BioPackageId = 'bio_solo' | 'bio_two' | 'bio_four';

export type BioPackageDisplay = {
  id: BioPackageId;
  cardTitle: string;
  guestCount: number;
  standardValueUsd: number;
  directPriceUsd: number;
  perGuestUsd: number;
  savingsUsd: number;
  discountPercentLabel: string;
  badge: string | null;
  ctaLabel: string;
  included: readonly string[];
};

/** Must stay aligned with server/config/bioluminescencePackages.js */
export const BIO_PACKAGE_DISPLAY: BioPackageDisplay[] = [
  {
    id: 'bio_solo',
    cardTitle: 'Solo Glow Tour',
    guestCount: 1,
    standardValueUsd: 75,
    directPriceUsd: 40,
    perGuestUsd: 40,
    savingsUsd: 35,
    discountPercentLabel: '47% off',
    badge: null,
    ctaLabel: 'Select Solo Tour',
    included: ['Captain included', 'Fuel included'],
  },
  {
    id: 'bio_two',
    cardTitle: 'Glow Tour for Two',
    guestCount: 2,
    standardValueUsd: 150,
    directPriceUsd: 78,
    perGuestUsd: 39,
    savingsUsd: 72,
    discountPercentLabel: '48% off',
    badge: null,
    ctaLabel: 'Select Tour for Two',
    included: ['Captain included', 'Fuel included'],
  },
  {
    id: 'bio_four',
    cardTitle: 'Glow Tour for Four',
    guestCount: 4,
    standardValueUsd: 300,
    directPriceUsd: 150,
    perGuestUsd: 37.5,
    savingsUsd: 150,
    discountPercentLabel: '50% off',
    badge: 'Best Value',
    ctaLabel: 'Select Tour for Four',
    included: ['Captain included', 'Fuel included'],
  },
];

/**
 * Mirrors server flag: package UI/checkout only when VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED=true.
 * Missing or any other value keeps legacy per-guest bio pricing in BookNow.
 */
export function isDirectBioPackagePricingEnabled(): boolean {
  return import.meta.env.VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED === 'true';
}

export function getBioPackageDisplay(id: string | null | undefined): BioPackageDisplay | null {
  const key = String(id || '').trim() as BioPackageId;
  return BIO_PACKAGE_DISPLAY.find((p) => p.id === key) ?? null;
}

export function bioBookingUrl(packageId: BioPackageId): string {
  return `/booking?bookingMode=charter&charterType=bio&package=${encodeURIComponent(packageId)}`;
}

export const BIO_PACKAGE_PRICING_DISCLAIMER =
  'Direct prices match our standard Groupon deal prices. Groupon-issued promotional codes may vary.';

export const BIO_LEGACY_PRICING_LABEL = 'Legacy bioluminescence pricing';

/** Admin staff booking — labels must match server package prices. */
export const BIO_STAFF_PACKAGE_OPTIONS = BIO_PACKAGE_DISPLAY.map((p) => ({
  id: p.id,
  label: `${p.cardTitle} — $${p.directPriceUsd}`,
  guestCount: p.guestCount,
  standardValueUsd: p.standardValueUsd,
  directPriceUsd: p.directPriceUsd,
  savingsUsd: p.savingsUsd,
}));
