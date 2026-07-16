import { env } from '../config/env.js';

export type PublicBookingMatch = {
  id: string;
  customer_name: string;
  email?: string;
  email_masked?: string;
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
      email: input.email.trim().toLowerCase(),
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

export async function fetchWaiversBookingById(
  bookingId: string
): Promise<FindBookingResult> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, message: 'API is not configured. Please call 803-542-1761 for help.' };
  }

  const res = await fetch(
    `${env.apiUrl}/api/public/waivers-booking?bookingId=${encodeURIComponent(bookingId.trim())}`
  );
  const payload = (await res.json().catch(() => ({}))) as {
    booking?: PublicBookingMatch;
    message?: string;
    error?: string;
  };

  if (!res.ok || !payload.booking) {
    return {
      ok: false,
      message: payload.message || payload.error || 'Booking not found or no longer active.',
    };
  }

  return { ok: true, booking: payload.booking };
}

export async function confirmWaiversAccess(input: {
  bookingId: string;
  phone: string;
}): Promise<FindBookingResult> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, message: 'API is not configured.' };
  }

  const res = await fetch(`${env.apiUrl}/api/public/confirm-waivers-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    booking?: PublicBookingMatch;
    error?: string;
  };

  if (!res.ok || !payload.booking?.email) {
    return {
      ok: false,
      message: payload.error || 'Phone does not match this booking.',
    };
  }

  return { ok: true, booking: payload.booking };
}

export async function verifyBookingGate(
  bookingId: string,
  email: string
): Promise<{ ok: boolean; error?: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API is not configured.' };
  }

  const res = await fetch(`${env.apiUrl}/api/public/verify-booking-gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, email }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { ok: false, error: payload.error || 'Email does not match.' };
  return { ok: true };
}

export type VerifyBookingShell = {
  id: string;
  status: string;
  boat_id: string;
  boat_name: string | null;
  boat_type: string | null;
  license_status: string;
  has_license_url: boolean;
  insurance_verification: { buoy_status: string; has_proof: boolean };
};

export async function fetchVerifyBookingShell(
  bookingId: string
): Promise<{ ok: true; booking: VerifyBookingShell } | { ok: false; error: string; status?: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API is not configured.' };
  }

  const res = await fetch(
    `${env.apiUrl}/api/public/verify-booking?bookingId=${encodeURIComponent(bookingId)}`
  );
  const payload = (await res.json().catch(() => ({}))) as {
    booking?: VerifyBookingShell;
    error?: string;
    status?: string;
  };

  if (!res.ok || !payload.booking) {
    return { ok: false, error: payload.error || 'Could not load booking.', status: payload.status };
  }

  return { ok: true, booking: payload.booking };
}

export async function requestBookingUploadUrl(input: {
  bookingId: string;
  email: string;
  phone?: string;
  folder: 'licenses' | 'insurance';
  fileName: string;
}): Promise<
  | { ok: true; signedUrl: string; publicUrl: string | null; path: string; bucket: string }
  | { ok: false; error: string }
> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API is not configured.' };
  }

  const res = await fetch(`${env.apiUrl}/api/public/booking-upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    signedUrl?: string;
    publicUrl?: string | null;
    path?: string;
    bucket?: string;
    error?: string;
  };

  if (!res.ok || !payload.signedUrl || !payload.path || !payload.bucket) {
    return { ok: false, error: payload.error || 'Could not prepare upload.' };
  }

  return {
    ok: true,
    signedUrl: payload.signedUrl,
    publicUrl: payload.publicUrl ?? null,
    path: payload.path,
    bucket: payload.bucket,
  };
}

export async function markInsuranceProof(input: {
  bookingId: string;
  email: string;
  phone?: string;
  proofUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API is not configured.' };
  }

  const res = await fetch(`${env.apiUrl}/api/booking-mark-insurance-proof`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { ok: false, error: payload.error || 'Could not save proof.' };
  return { ok: true };
}

export type PreTripStatusPayload = {
  submission: {
    id: string;
    customer_name: string | null;
    trip_type: string;
    groupon_code: string | null;
    waiver_signed: boolean;
    license_status: string;
    insurance_status: string;
    has_license_url: boolean;
    has_insurance_url: boolean;
    admin_status: string;
    matched_booking_id: string | null;
    created_at: string;
  };
  matched_booking: {
    id: string;
    status: string;
    start_time: string;
  } | null;
};

export async function fetchPreTripStatus(
  submissionId: string,
  email: string,
  phone: string
): Promise<{ ok: true; data: PreTripStatusPayload } | { ok: false; error: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API is not configured.' };
  }

  const params = new URLSearchParams({
    submissionId: submissionId.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
  });
  const res = await fetch(`${env.apiUrl}/api/public/pre-trip-status?${params}`);
  const payload = (await res.json().catch(() => ({}))) as PreTripStatusPayload & { error?: string };

  if (!res.ok) {
    return { ok: false, error: payload.error || 'Could not load status.' };
  }

  return { ok: true, data: payload };
}

export type PreTripMatchSuggestion = {
  id: string;
  customer_name: string | null;
  email: string | null;
  start_time: string;
  promo_code: string | null;
  status: string;
  boat_name: string | null;
  match_reason: string;
};

export async function fetchPreTripMatchSuggestions(
  token: string,
  submissionId: string,
  query?: string
): Promise<{ ok: true; suggestions: PreTripMatchSuggestion[] } | { ok: false; error: string }> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API not configured' };
  }

  const params = new URLSearchParams();
  if (query?.trim()) params.set('q', query.trim());
  const qs = params.toString();

  const res = await fetch(
    `${env.apiUrl}/api/admin/pre-trip-submissions/${encodeURIComponent(submissionId)}/suggestions${qs ? `?${qs}` : ''}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const payload = (await res.json().catch(() => ({}))) as {
    suggestions?: PreTripMatchSuggestion[];
    error?: string;
  };

  if (!res.ok) {
    return { ok: false, error: payload.error || 'Could not load suggestions' };
  }

  return { ok: true, suggestions: payload.suggestions || [] };
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
  /** Stable client draft UUID — used for server-side idempotency. */
  clientDraftId?: string;
}): Promise<
  | { ok: true; submissionId: string; duplicate?: boolean }
  | { ok: false; error: string }
> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'API is not configured.' };
  }

  const clientDraftId = String(input.clientDraftId || '').trim() || undefined;

  const res = await fetch(`${env.apiUrl}/api/public/pre-trip-submission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: input.customerName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      tripType: input.tripType,
      grouponCode: input.grouponCode?.trim() || undefined,
      requestedTripDate: input.requestedTripDate || undefined,
      waiverSignature: input.waiverSignature,
      waiverAgreed: input.waiverAgreed,
      termsAccepted: input.termsAccepted,
      damageFeeAcknowledged: input.damageFeeAcknowledged,
      licenseUrl: input.licenseUrl || undefined,
      insuranceUrl: input.insuranceUrl || undefined,
      clientDraftId,
      client_draft_id: clientDraftId,
      idempotencyKey: clientDraftId,
      idempotency_key: clientDraftId,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    submissionId?: string;
    duplicate?: boolean;
    error?: string;
    code?: string;
  };

  if (!res.ok || !payload.submissionId) {
    return {
      ok: false,
      error:
        payload.error ||
        (payload.code === 'missing_draft_id'
          ? 'We could not connect your documents to your registration. Your information is still saved. Please try again.'
          : 'Could not submit. Try again or call us.'),
    };
  }

  return {
    ok: true,
    submissionId: payload.submissionId,
    duplicate: Boolean(payload.duplicate),
  };
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
