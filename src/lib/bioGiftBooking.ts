/**
 * Client helpers for bioluminescence gift mode (no departure date at purchase).
 * Prices and ticket codes are enforced on the server.
 */

import {
  BIO_PACKAGE_DISPLAY,
  formatBioPackagePriceUsd,
  getBioPackageDisplay,
  type BioPackageId,
} from './bioluminescencePackages';
import { bioGiftBookingUrl } from './directBookingFlow.js';
import { getActiveBioBookingSeason } from './bioluminescenceSeason';

export const BIO_GIFT_MIN_TICKETS = 1;
export const BIO_GIFT_MAX_TICKETS = 10;

export const BIO_GIFT_NO_DATE_MESSAGE =
  'No date required. Your recipient chooses their 2027 adventure later.';

export type BioGiftRecipientMode = 'same' | 'different';

export type BioGiftTicketRecipient = {
  recipientName: string;
  recipientEmail: string;
  giftMessage: string;
  fromName: string;
};

export type BioGiftCheckoutPayload = {
  packageId: BioPackageId;
  ticketQuantity: number;
  recipientMode: BioGiftRecipientMode;
  tickets: BioGiftTicketRecipient[];
  purchaser: {
    fullName: string;
    email: string;
    phone: string;
  };
};

export function emptyBioGiftTicketRecipient(): BioGiftTicketRecipient {
  return {
    recipientName: '',
    recipientEmail: '',
    giftMessage: '',
    fromName: '',
  };
}

export function buildBioGiftTicketRecipients(
  quantity: number,
  previous: BioGiftTicketRecipient[] = []
): BioGiftTicketRecipient[] {
  const qty = clampBioGiftTicketQuantity(quantity);
  return Array.from({ length: qty }, (_, i) => ({
    ...emptyBioGiftTicketRecipient(),
    ...(previous[i] || {}),
  }));
}

export function isBioGiftPackageId(packageId: string | null | undefined): packageId is BioPackageId {
  return Boolean(getBioPackageDisplay(packageId));
}

export function clampBioGiftTicketQuantity(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return BIO_GIFT_MIN_TICKETS;
  return Math.min(BIO_GIFT_MAX_TICKETS, Math.max(BIO_GIFT_MIN_TICKETS, n));
}

export function estimateBioGiftTotalUsd(packageId: BioPackageId, ticketQuantity: number): number | null {
  const pkg = getBioPackageDisplay(packageId);
  if (!pkg) return null;
  const qty = clampBioGiftTicketQuantity(ticketQuantity);
  return Number((pkg.directPriceUsd * qty).toFixed(2));
}

export function formatBioGiftTotalLabel(packageId: BioPackageId, ticketQuantity: number): string {
  const total = estimateBioGiftTotalUsd(packageId, ticketQuantity);
  if (total == null) return '';
  return formatBioPackagePriceUsd(total);
}

export function bioGiftSeasonLabel(): string {
  const season = getActiveBioBookingSeason();
  const year = season?.year ?? 2027;
  return `${year} season · June–October`;
}

export function bioGiftPackageOptions() {
  return BIO_PACKAGE_DISPLAY;
}

/** Client-side check before submit; server re-validates. */
export function validateBioGiftRecipientsClient(
  mode: BioGiftRecipientMode,
  tickets: BioGiftTicketRecipient[]
): string | null {
  if (!tickets.length) return 'Add at least one gift ticket.';
  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    const label = mode === 'different' && tickets.length > 1 ? `Ticket ${i + 1}` : 'Gift';
    if (!ticket.recipientName.trim()) {
      return `${label}: enter the recipient name.`;
    }
    if (!ticket.fromName.trim()) {
      return `${label}: enter who the gift is from.`;
    }
    const email = ticket.recipientEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return `${label}: recipient email looks invalid.`;
    }
  }
  return null;
}

export { bioGiftBookingUrl };
