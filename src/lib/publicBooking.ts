import { env } from '../config/env.js';

export type PublicBookingMatch = {
  id: string;
  customer_name: string;
  email: string;
  phone_last4: string;
  start_time: string;
  end_time: string;
  rental_type: string;
  boat_id: string;
  boat_name: string | null;
  boat_type: string | null;
  captain_included: boolean;
  status: string;
  payment_status: string;
  waiver_signed: boolean;
  license_status: string;
  insurance_status: string;
  has_license_url: boolean;
  has_insurance_url: boolean;
};

export type FindBookingResult =
  | { ok: true; booking: PublicBookingMatch }
  | { ok: false; message: string };

export async function findPublicBooking(input: {
  email: string;
  phone: string;
  code?: string;
}): Promise<FindBookingResult> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, message: 'API is not configured. Please call 803-542-1761 for help.' };
  }

  const res = await fetch(`${env.apiUrl}/api/public/find-booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email.trim(),
      phone: input.phone.trim(),
      code: input.code?.trim() || undefined,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    booking?: PublicBookingMatch;
    message?: string;
    error?: string;
  };

  if (!res.ok || !payload.booking) {
    return {
      ok: false,
      message:
        payload.message ||
        payload.error ||
        'We could not find a booking with that information. Double-check your email and phone, or call us.',
    };
  }

  return { ok: true, booking: payload.booking };
}

export async function signBookingWaiver(input: {
  bookingId: string;
  email: string;
  phone: string;
  signature: string;
  termsAccepted: boolean;
  damageFeeAcknowledged: boolean;
  waiverAgreed: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API is not configured.' };
  }

  const res = await fetch(`${env.apiUrl}/api/booking-sign-waiver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return { ok: false, error: payload.error || 'Could not save waiver.' };
  }
  return { ok: true };
}

export type PreTripTripType = 'pontoon_rental' | 'center_console_rental' | 'captain_charter';

export async function submitPreTripSubmission(input: {
  customerName: string;
  email: string;
  phone: string;
  tripType: PreTripTripType;
  grouponCode?: string;
  requestedTripDate?: string;
  waiverSignature: string;
  waiverAgreed: boolean;
  termsAccepted: boolean;
  damageFeeAcknowledged: boolean;
  licenseUrl?: string | null;
  insuranceUrl?: string | null;
}): Promise<{ ok: true; submissionId: string } | { ok: false; error: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API is not configured.' };
  }

  const res = await fetch(`${env.apiUrl}/api/public/pre-trip-submission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: input.customerName,
      email: input.email,
      phone: input.phone,
      tripType: input.tripType,
      grouponCode: input.grouponCode || undefined,
      requestedTripDate: input.requestedTripDate || undefined,
      waiverSignature: input.waiverSignature,
      waiverAgreed: input.waiverAgreed,
      termsAccepted: input.termsAccepted,
      damageFeeAcknowledged: input.damageFeeAcknowledged,
      licenseUrl: input.licenseUrl || undefined,
      insuranceUrl: input.insuranceUrl || undefined,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    submissionId?: string;
    error?: string;
  };

  if (!res.ok || !payload.submissionId) {
    return { ok: false, error: payload.error || 'Could not submit. Try again or call us.' };
  }

  return { ok: true, submissionId: payload.submissionId };
}

export async function adminUpdatePreTripSubmission(
  token: string,
  submissionId: string,
  body: {
    action: 'match' | 'approve' | 'reject';
    matched_booking_id?: string;
    admin_notes?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API not configured' };
  }

  const res = await fetch(`${env.apiUrl}/api/admin/pre-trip-submissions/${encodeURIComponent(submissionId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { ok: false, error: payload.error || 'Update failed' };
  return { ok: true };
}
