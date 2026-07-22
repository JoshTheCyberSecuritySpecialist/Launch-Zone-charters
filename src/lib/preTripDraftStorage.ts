/**
 * Browser helpers for restoring /waivers-insurance manual flow progress.
 * Does not store signatures or raw document bytes — only field values and uploaded public URLs.
 */

import type { PreTripTripType } from './publicBooking';

const DRAFT_KEY = 'lz_pre_trip_manual_draft_v2';
const DRAFT_KEY_V1 = 'lz_pre_trip_manual_draft_v1';
const COMPLETED_KEY = 'lz_pre_trip_completed_v1';

export type ManualPreTripStep = 'info' | 'trip' | 'passengers' | 'documents' | 'review';

export type ManualPreTripDraft = {
  draftId: string;
  step: ManualPreTripStep;
  customerName: string;
  email: string;
  phone: string;
  tripType: PreTripTripType;
  grouponCode: string;
  requestedTripDate: string;
  termsAccepted: boolean;
  damageFeeAcknowledged: boolean;
  waiverAgreed: boolean;
  /** Uploaded document public URLs only — not file contents. */
  licenseUrl: string | null;
  insuranceUrl: string | null;
  updatedAt: string;
};

export type CompletedPreTripRef = {
  submissionId: string;
  email: string;
  /** Last-10 or full digits optional — used only to prefill the status gate. */
  phone?: string;
  completedAt: string;
};

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function normalizeDraftEmail(email: string): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeClientDraftId(raw: string | null | undefined): string | null {
  const key = String(raw || '').trim();
  if (!key || !UUID_RE.test(key)) return null;
  return key.toLowerCase();
}

/** Pull draft UUID from a documents URL path: .../licenses|insurance/pre-trip/{uuid}/... */
export function extractClientDraftIdFromDocumentUrl(rawUrl: string | null | undefined): string | null {
  const urlStr = String(rawUrl || '').trim();
  if (!urlStr) return null;
  let path = urlStr;
  try {
    path = decodeURIComponent(new URL(urlStr).pathname);
  } catch {
    // match against raw string
  }
  const match = path.match(
    /\/(?:licenses|insurance)\/pre-trip\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i
  );
  return normalizeClientDraftId(match?.[1]);
}

/**
 * Canonical draft ID for final submit / uploads.
 * Prefer document URL path when it disagrees with in-memory state (uploads already used that path).
 */
export function resolveClientDraftId(input: {
  draftId?: string | null;
  licenseUrl?: string | null;
  insuranceUrl?: string | null;
}): { clientDraftId: string | null; source: string } {
  const fromState = normalizeClientDraftId(input.draftId);
  const fromLicense = extractClientDraftIdFromDocumentUrl(input.licenseUrl);
  const fromInsurance = extractClientDraftIdFromDocumentUrl(input.insuranceUrl);
  const fromUrl = fromLicense || fromInsurance;
  const fromStorage = normalizeClientDraftId(loadManualPreTripDraft()?.draftId);

  if (fromLicense && fromInsurance && fromLicense !== fromInsurance) {
    return { clientDraftId: null, source: 'mismatch' };
  }
  if (fromUrl) {
    return { clientDraftId: fromUrl, source: 'document_url' };
  }
  if (fromState) {
    return { clientDraftId: fromState, source: 'state' };
  }
  if (fromStorage) {
    return { clientDraftId: fromStorage, source: 'session' };
  }
  return { clientDraftId: null, source: 'none' };
}

/** Map legacy fine-grained steps onto the senior-friendly 4-step flow. */
export function normalizeManualStep(raw: string | undefined | null): ManualPreTripStep {
  switch (String(raw || '')) {
    case 'info':
      return 'info';
    case 'trip':
      return 'trip';
    case 'documents':
    case 'waiver':
    case 'license':
    case 'buoy':
    case 'proof':
      return 'documents';
    case 'review':
    case 'submit':
      return 'review';
    default:
      return 'info';
  }
}

export function loadManualPreTripDraft(): ManualPreTripDraft | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY) || window.sessionStorage.getItem(DRAFT_KEY_V1);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManualPreTripDraft;
    if (!parsed?.draftId) return null;
    return {
      ...parsed,
      step: normalizeManualStep(parsed.step),
      email: normalizeDraftEmail(parsed.email || ''),
    };
  } catch {
    return null;
  }
}

export function saveManualPreTripDraft(draft: ManualPreTripDraft): void {
  if (!canUseStorage()) return;
  try {
    const payload: ManualPreTripDraft = {
      ...draft,
      step: normalizeManualStep(draft.step),
      email: normalizeDraftEmail(draft.email),
      customerName: String(draft.customerName || '').trim(),
      phone: String(draft.phone || '').trim(),
      grouponCode: String(draft.grouponCode || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function clearManualPreTripDraft(): void {
  if (!canUseStorage()) return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
    window.sessionStorage.removeItem(DRAFT_KEY_V1);
  } catch {
    // ignore
  }
}

export function loadCompletedPreTripRef(): CompletedPreTripRef | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(COMPLETED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompletedPreTripRef;
    if (!parsed?.submissionId || !parsed?.email) return null;
    return {
      submissionId: String(parsed.submissionId).trim(),
      email: normalizeDraftEmail(parsed.email),
      phone: parsed.phone ? String(parsed.phone).trim() : '',
      completedAt: parsed.completedAt || '',
    };
  } catch {
    return null;
  }
}

export function saveCompletedPreTripRef(submissionId: string, email: string, phone = ''): void {
  if (!canUseStorage()) return;
  try {
    const payload: CompletedPreTripRef = {
      submissionId: String(submissionId).trim(),
      email: normalizeDraftEmail(email),
      phone: String(phone || '').trim(),
      completedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(COMPLETED_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function clearCompletedPreTripRef(): void {
  if (!canUseStorage()) return;
  try {
    window.sessionStorage.removeItem(COMPLETED_KEY);
  } catch {
    // ignore
  }
}

/** Kept for compatibility; 4-step flow no longer has rental-only step keys. */
export function coerceStepForTripType(
  step: ManualPreTripStep,
  tripType?: PreTripTripType
): ManualPreTripStep {
  void tripType;
  return normalizeManualStep(step);
}
