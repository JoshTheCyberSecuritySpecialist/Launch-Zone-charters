import { env } from '../config/env.js';

export type GiftCertificatePublic = {
  giftCode: string;
  status: string;
  redeemable: boolean;
  packageId: string | null;
  packageName: string | null;
  guestCount: number;
  recipientName: string | null;
  fromName: string | null;
  giftMessage: string | null;
  seasonYear: number;
  validFrom: string;
  validUntil: string;
  redeemedAt: string | null;
  capacityConsumed: boolean;
};

export type GiftRedeemResult = {
  ok: true;
  bookingId: string;
  giftCode: string;
  status: string;
  startTime: string;
  startLabel: string;
  packageName: string;
  guestCount: number;
  capacityConsumed: boolean;
};

function apiBase(): string {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('Booking service is not configured.');
  }
  return env.apiUrl.replace(/\/$/, '');
}

export async function fetchGiftCertificate(code: string): Promise<GiftCertificatePublic> {
  const res = await fetch(`${apiBase()}/api/gift-certificates/${encodeURIComponent(code)}`);
  const data = (await res.json().catch(() => ({}))) as GiftCertificatePublic & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Could not find that gift code.');
  }
  return data;
}

export async function redeemGiftCertificate(input: {
  code: string;
  startTime: string;
  customer: { full_name: string; email: string; phone: string; sms_opt_in?: boolean };
  waiver: { accepted: boolean; signature: string };
  termsAccepted: boolean;
  specialRequests?: string;
}): Promise<GiftRedeemResult> {
  const res = await fetch(
    `${apiBase()}/api/gift-certificates/${encodeURIComponent(input.code)}/redeem`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startTime: input.startTime,
        customer: input.customer,
        waiver: input.waiver,
        termsAccepted: input.termsAccepted,
        specialRequests: input.specialRequests || undefined,
      }),
    }
  );
  const data = (await res.json().catch(() => ({}))) as GiftRedeemResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Could not redeem this gift ticket.');
  }
  return data;
}
