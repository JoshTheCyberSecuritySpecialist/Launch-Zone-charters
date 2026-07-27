import { env } from '../config/env.js';

export type GrouponVerifyResult =
  | {
      ok: true;
      clientToken: string;
      reservationExpiresAt: string;
      voucherMasked: string;
      serviceLabel: string | null;
      coveredGuestCount: number;
      bookingType: 'rental' | 'charter' | null;
      charterType: string | null;
      rentalType: string | null;
      rentalLocation: string | null;
      rentalBoatId?: string | null;
      dealName: string | null;
      optionName: string | null;
      expiresAt: string | null;
    }
  | { ok: false; message: string };

export type GrouponSessionInfo = {
  reservationExpiresAt: string;
  voucherMasked: string;
  serviceLabel: string | null;
  coveredGuestCount: number;
  bookingType: 'rental' | 'charter' | null;
  charterType: string | null;
  rentalType: string | null;
  rentalLocation: string | null;
  rentalBoatId?: string | null;
  dealName: string | null;
  optionName: string | null;
  expiresAt: string | null;
};

const SESSION_STORAGE_KEY = 'lz_groupon_client_token';

export function saveGrouponClientToken(token: string) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

export function readGrouponClientToken(): string {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function clearGrouponClientToken() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function verifyGrouponVoucher(input: {
  voucherNumber: string;
  lastName: string;
}): Promise<GrouponVerifyResult> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, message: 'Online booking is unavailable right now. Please call 803-542-1761.' };
  }
  const res = await fetch(`${env.apiUrl}/api/public/groupon/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voucherNumber: input.voucherNumber.trim(),
      lastName: input.lastName.trim(),
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      message: String(payload.error || 'We could not verify that voucher. Check the voucher number and last name.'),
    };
  }
  saveGrouponClientToken(String(payload.clientToken || ''));
  return {
    ok: true,
    clientToken: String(payload.clientToken || ''),
    reservationExpiresAt: String(payload.reservationExpiresAt || ''),
    voucherMasked: String(payload.voucherMasked || ''),
    serviceLabel: payload.serviceLabel ? String(payload.serviceLabel) : null,
    coveredGuestCount: Number(payload.coveredGuestCount || 1),
    bookingType: (payload.bookingType as 'rental' | 'charter' | null) || null,
    charterType: payload.charterType ? String(payload.charterType) : null,
    rentalType: payload.rentalType ? String(payload.rentalType) : null,
    rentalLocation: payload.rentalLocation ? String(payload.rentalLocation) : null,
    rentalBoatId: payload.rentalBoatId ? String(payload.rentalBoatId) : null,
    dealName: payload.dealName ? String(payload.dealName) : null,
    optionName: payload.optionName ? String(payload.optionName) : null,
    expiresAt: payload.expiresAt ? String(payload.expiresAt) : null,
  };
}

export async function fetchGrouponSession(clientToken: string): Promise<GrouponSessionInfo | null> {
  if (!env.apiUrlConfigured || !env.apiUrl || !clientToken) return null;
  const q = new URLSearchParams({ token: clientToken });
  const res = await fetch(`${env.apiUrl}/api/public/groupon/session?${q.toString()}`);
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return null;
  return {
    reservationExpiresAt: String(payload.reservationExpiresAt || ''),
    voucherMasked: String(payload.voucherMasked || ''),
    serviceLabel: payload.serviceLabel ? String(payload.serviceLabel) : null,
    coveredGuestCount: Number(payload.coveredGuestCount || 1),
    bookingType: (payload.bookingType as 'rental' | 'charter' | null) || null,
    charterType: payload.charterType ? String(payload.charterType) : null,
    rentalType: payload.rentalType ? String(payload.rentalType) : null,
    rentalLocation: payload.rentalLocation ? String(payload.rentalLocation) : null,
    rentalBoatId: payload.rentalBoatId ? String(payload.rentalBoatId) : null,
    dealName: payload.dealName ? String(payload.dealName) : null,
    optionName: payload.optionName ? String(payload.optionName) : null,
    expiresAt: payload.expiresAt ? String(payload.expiresAt) : null,
  };
}

export async function submitGrouponBooking(input: {
  clientToken: string;
  customer: {
    full_name: string;
    email: string;
    phone: string;
    sms_opt_in?: boolean;
  };
  booking: {
    start_time: string;
    end_time?: string;
    special_requests?: string;
  };
  waiver: { accepted: boolean; signature: string };
  legal: {
    termsAccepted: boolean;
    damageFeeAcknowledged: boolean;
    signaturePresent: boolean;
  };
}): Promise<{ ok: true; bookingId: string } | { ok: false; message: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, message: 'Online booking is unavailable right now. Please call 803-542-1761.' };
  }
  const res = await fetch(`${env.apiUrl}/api/public/groupon/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    booking?: { bookingId?: string };
    error?: string;
  };
  if (!res.ok || !payload.booking?.bookingId) {
    return { ok: false, message: payload.error || 'Could not complete your Groupon booking.' };
  }
  clearGrouponClientToken();
  return { ok: true, bookingId: payload.booking.bookingId };
}
