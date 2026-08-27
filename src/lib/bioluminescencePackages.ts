/**
 * Presentation-only mirror of server bioluminescence packages.
 * Checkout amounts and guest counts are enforced on the server — never send prices in URLs.
 */

import { DateTime } from 'luxon';
import { BUSINESS_TZ } from './bookingDateTimeRange';
import { DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES } from './charterDuration';

export type BioPackageId = 'bio_solo' | 'bio_two' | 'bio_three' | 'bio_four';

export const BIO_DIRECT_PROMOTION = {
  enabled: true,
  label: 'Direct Booking Special',
  startsAt: null as string | null,
  endsAt: null as string | null,
};

type BioPackageBase = {
  id: BioPackageId;
  cardTitle: string;
  guestCount: number;
  regularPriceCents: number;
  promotionalPriceCents: number;
  badge: string | null;
  ctaLabel: string;
  included: readonly string[];
  durationMinutes: number;
};

export type BioPackageDisplay = BioPackageBase & {
  regularPriceUsd: number;
  directPriceUsd: number;
  perGuestUsd: number;
  savingsUsd: number;
  discountPercentLabel: string;
  promotionActive: boolean;
  promotionLabel: string | null;
  /** Alias of regularPriceUsd for staff snapshot / existing callers. */
  standardValueUsd: number;
};

const BIO_PACKAGE_BASE: readonly BioPackageBase[] = [
  {
    id: 'bio_solo',
    cardTitle: 'Solo Glow Tour',
    guestCount: 1,
    regularPriceCents: 5850,
    promotionalPriceCents: 4499,
    badge: null,
    ctaLabel: 'Select Solo Tour',
    included: ['Captain included', 'Fuel included'],
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
  },
  {
    id: 'bio_two',
    cardTitle: 'Glow Tour for Two',
    guestCount: 2,
    regularPriceCents: 12000,
    promotionalPriceCents: 8999,
    badge: null,
    ctaLabel: 'Select Tour for Two',
    included: ['Captain included', 'Fuel included'],
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
  },
  {
    id: 'bio_three',
    cardTitle: 'Glow Tour for Three',
    guestCount: 3,
    regularPriceCents: 18000,
    promotionalPriceCents: 13499,
    badge: null,
    ctaLabel: 'Select Tour for Three',
    included: ['Captain included', 'Fuel included'],
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
  },
  {
    id: 'bio_four',
    cardTitle: 'Glow Tour for Four',
    guestCount: 4,
    regularPriceCents: 24000,
    promotionalPriceCents: 17999,
    badge: 'Best Value',
    ctaLabel: 'Select Tour for Four',
    included: ['Captain included', 'Fuel included'],
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
  },
];

function parsePromotionBound(raw: string | null | undefined, endOfDay = false): DateTime | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  let dt = DateTime.fromISO(text, { zone: BUSINESS_TZ });
  if (!dt.isValid) return null;
  if (endOfDay && !text.includes('T')) {
    dt = dt.endOf('day');
  }
  return dt;
}

export function isBioDirectPromotionActive(now: Date | DateTime = DateTime.now()): boolean {
  if (!BIO_DIRECT_PROMOTION.enabled) return false;
  const current =
    now && typeof (now as DateTime).toMillis === 'function'
      ? (now as DateTime).setZone(BUSINESS_TZ)
      : DateTime.fromJSDate(now instanceof Date ? now : new Date(), { zone: BUSINESS_TZ });
  const startsAt = parsePromotionBound(BIO_DIRECT_PROMOTION.startsAt);
  if (startsAt && current < startsAt) return false;
  const endsAt = parsePromotionBound(BIO_DIRECT_PROMOTION.endsAt, true);
  if (endsAt && current > endsAt) return false;
  return true;
}

function centsToUsd(cents: number): number {
  return cents / 100;
}

function toDisplayPackage(base: BioPackageBase, now?: Date | DateTime): BioPackageDisplay {
  const promotionActive = isBioDirectPromotionActive(now);
  const chargeCents = promotionActive ? base.promotionalPriceCents : base.regularPriceCents;
  const savingsCents = Math.max(0, base.regularPriceCents - chargeCents);
  const discountPercentLabel =
    savingsCents > 0 && base.regularPriceCents > 0
      ? `${Math.round((savingsCents / base.regularPriceCents) * 100)}% off`
      : '';
  const regularPriceUsd = centsToUsd(base.regularPriceCents);
  const directPriceUsd = centsToUsd(chargeCents);
  return {
    ...base,
    regularPriceUsd,
    standardValueUsd: regularPriceUsd,
    directPriceUsd,
    perGuestUsd: centsToUsd(chargeCents) / base.guestCount,
    savingsUsd: centsToUsd(savingsCents),
    discountPercentLabel,
    promotionActive,
    promotionLabel: promotionActive ? BIO_DIRECT_PROMOTION.label : null,
  };
}

/** Must stay aligned with server/config/bioluminescencePackages.js */
export const BIO_PACKAGE_DISPLAY: BioPackageDisplay[] = BIO_PACKAGE_BASE.map((pkg) => toDisplayPackage(pkg));

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
  'Direct Booking Special prices are shown. Regular package prices apply when the special is not active.';

export const BIO_LEGACY_PRICING_LABEL = 'Legacy bioluminescence pricing';

/** Admin staff booking — labels must match server package prices. */
export const BIO_STAFF_PACKAGE_OPTIONS = BIO_PACKAGE_DISPLAY.map((p) => ({
  id: p.id,
  label: `${p.cardTitle} — $${Number.isInteger(p.directPriceUsd) ? p.directPriceUsd : p.directPriceUsd.toFixed(2)}`,
  guestCount: p.guestCount,
  standardValueUsd: p.standardValueUsd,
  directPriceUsd: p.directPriceUsd,
  savingsUsd: p.savingsUsd,
}));

export function formatBioPackagePriceUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export const BIO_PACKAGE_PRICE_SUMMARY = BIO_PACKAGE_DISPLAY.map((p) => ({
  id: p.id,
  guestLabel: p.guestCount === 1 ? '1 Person' : `${p.guestCount} People`,
  totalLabel: formatBioPackagePriceUsd(p.directPriceUsd),
  perGuestLabel:
    p.guestCount === 1
      ? `${formatBioPackagePriceUsd(p.perGuestUsd)}/person`
      : `${formatBioPackagePriceUsd(p.directPriceUsd)} total · ${formatBioPackagePriceUsd(p.perGuestUsd)}/person`,
}));
