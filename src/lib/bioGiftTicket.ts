/**
 * Presentation helpers for bioluminescence gift tickets (boarding-pass style).
 * Ticket visuals are shown only after Stripe confirms payment.
 */

import {
  getBioPackageDisplay,
  isBioPrivatePackageId,
  type BioPackageId,
} from './bioluminescencePackages';
import { getActiveBioBookingSeason } from './bioluminescenceSeason';
import { siteOrigin } from './siteOrigin';

export const BIO_GIFT_TICKET_TAGLINE = 'YOUR NIGHT ON THE GLOWING WATER AWAITS';

export const BIO_GIFT_TICKET_QR_HINT = 'Scan to choose your adventure date';

/** Approximate Max Brewer / Titusville lagoon coordinates for nautical styling. */
export const BIO_GIFT_TICKET_COORDINATES = '28.612°N  ·  80.807°W';

export type BioGiftTicketViewModel = {
  giftCode: string;
  recipientName: string;
  fromName: string;
  packageName: string;
  packageId: string | null;
  guestLabel: string;
  seasonYear: number;
  validSeasonLabel: string;
  giftMessage: string | null;
  redeemUrl: string;
  ticketIndex?: number;
  ticketCount?: number;
};

export function bioGiftRedeemPath(giftCode: string): string {
  const code = String(giftCode || '')
    .trim()
    .toUpperCase();
  return `/redeem/${encodeURIComponent(code)}`;
}

export function bioGiftRedeemAbsoluteUrl(giftCode: string): string {
  return `${siteOrigin()}${bioGiftRedeemPath(giftCode)}`;
}

export function formatBioGiftValidSeasonLabel(options?: {
  seasonYear?: number | null;
  seasonStart?: string | null;
  seasonEnd?: string | null;
}): string {
  const season = getActiveBioBookingSeason();
  const year = options?.seasonYear || season?.year || 2027;
  const start = options?.seasonStart || season?.bookingStart || `${year}-06-01`;
  const end = options?.seasonEnd || season?.bookingEnd || `${year}-10-31`;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });
    const startLabel = fmt.format(new Date(`${start}T12:00:00`));
    const endLabel = fmt.format(new Date(`${end}T12:00:00`));
    return `${startLabel} – ${endLabel}`;
  } catch {
    return `June 1 – October 31, ${year}`;
  }
}

export function bioGiftGuestLabel(packageId: string | null | undefined): string {
  const pkg = getBioPackageDisplay(packageId);
  if (!pkg) return '1 guest';
  if (isBioPrivatePackageId(pkg.id)) {
    const max = pkg.maxGuests || 5;
    return `Up to ${max} guests · private boat`;
  }
  return pkg.guestCount === 1 ? '1 guest' : `${pkg.guestCount} guests`;
}

export function buildBioGiftTicketViewModel(input: {
  giftCode: string;
  recipientName?: string | null;
  fromName?: string | null;
  packageName?: string | null;
  packageId?: string | null;
  seasonYear?: number | null;
  seasonStart?: string | null;
  seasonEnd?: string | null;
  giftMessage?: string | null;
  ticketIndex?: number;
  ticketCount?: number;
}): BioGiftTicketViewModel | null {
  const giftCode = String(input.giftCode || '').trim().toUpperCase();
  if (!giftCode) return null;
  const seasonYear = Number(input.seasonYear) || getActiveBioBookingSeason()?.year || 2027;
  const packageId = (input.packageId || null) as BioPackageId | null;
  const pkg = getBioPackageDisplay(packageId);
  return {
    giftCode,
    recipientName: String(input.recipientName || '').trim() || 'Guest',
    fromName: String(input.fromName || '').trim() || 'Launch Zone Charters',
    packageName:
      String(input.packageName || '').trim() ||
      pkg?.cardTitle ||
      'Bioluminescence Adventure',
    packageId,
    guestLabel: bioGiftGuestLabel(packageId),
    seasonYear,
    validSeasonLabel: formatBioGiftValidSeasonLabel({
      seasonYear,
      seasonStart: input.seasonStart,
      seasonEnd: input.seasonEnd,
    }),
    giftMessage: String(input.giftMessage || '').trim() || null,
    redeemUrl: bioGiftRedeemAbsoluteUrl(giftCode),
    ticketIndex: input.ticketIndex,
    ticketCount: input.ticketCount,
  };
}
