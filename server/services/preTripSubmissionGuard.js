/**
 * Idempotency helpers for public pre-trip submissions.
 * Keeps duplicate-prevention decisions unit-testable without Express/Supabase.
 */

function normalizeEmail(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function normalizePhoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function phoneLast10(raw) {
  const digits = normalizePhoneDigits(raw);
  if (!digits) return '';
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function phoneDigitsMatch(stored, provided) {
  const a = normalizePhoneDigits(stored);
  const b = normalizePhoneDigits(provided);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10)) return true;
  return false;
}

function normalizeIdempotencyKey(raw) {
  const key = String(raw || '').trim();
  if (!key) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return null;
  }
  return key.toLowerCase();
}

/**
 * Extract client draft UUID from a documents-bucket public/signed URL path
 * like .../licenses/pre-trip/{uuid}/file.jpg
 */
function extractPreTripDraftIdFromDocumentUrl(rawUrl) {
  const urlStr = String(rawUrl || '').trim();
  if (!urlStr) return null;
  let path = urlStr;
  try {
    path = decodeURIComponent(new URL(urlStr).pathname);
  } catch {
    // Fall through and match against the raw string.
  }
  const match = path.match(
    /\/(?:licenses|insurance)\/pre-trip\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i
  );
  return normalizeIdempotencyKey(match?.[1]);
}

/**
 * Resolve the draft UUID for a final submission from body and/or uploaded document URLs.
 * Document URL wins when body and URL disagree (uploads already wrote under that path).
 *
 * @returns {{ ok: true, id: string|null, source: string } | { ok: false, reason: string }}
 */
function resolveSubmissionDraftId(input) {
  const fromBody = normalizeIdempotencyKey(
    input?.clientDraftId || input?.client_draft_id || input?.idempotencyKey || input?.idempotency_key
  );
  const fromLicense = extractPreTripDraftIdFromDocumentUrl(input?.licenseUrl || input?.license_url);
  const fromInsurance = extractPreTripDraftIdFromDocumentUrl(
    input?.insuranceUrl || input?.insurance_url
  );

  if (fromLicense && fromInsurance && fromLicense !== fromInsurance) {
    return { ok: false, reason: 'draft_id_mismatch' };
  }

  const fromUrl = fromLicense || fromInsurance;
  if (fromBody && fromUrl && fromBody !== fromUrl) {
    return { ok: true, id: fromUrl, source: 'document_url' };
  }

  const id = fromBody || fromUrl || null;
  const hasDocs = Boolean(
    String(input?.licenseUrl || input?.license_url || '').trim() ||
      String(input?.insuranceUrl || input?.insurance_url || '').trim()
  );
  if (hasDocs && !id) {
    return { ok: false, reason: 'missing_draft_id' };
  }

  return {
    ok: true,
    id,
    source: fromBody ? 'body' : fromUrl ? 'document_url' : 'none',
  };
}

/**
 * Pick an existing submission to reuse instead of inserting another row.
 * Prefer exact idempotency_key match (only when email+phone also match that row);
 * otherwise same email+phone pending/recent submission.
 *
 * Empty phone never matches — callers must prove phone ownership for reuse.
 *
 * @param {object[]} candidates
 * @param {{ email: string, phone: string, idempotencyKey: string|null }} query
 * @returns {{ reuse: object|null, reason: string|null }}
 */
function pickReusableSubmission(candidates, query) {
  const email = normalizeEmail(query.email);
  const phone = String(query.phone || '').trim();
  const key = normalizeIdempotencyKey(query.idempotencyKey);
  const rows = Array.isArray(candidates) ? candidates : [];

  if (!email || !phone) return { reuse: null, reason: null };

  if (key) {
    const byKey = rows.find((r) => normalizeIdempotencyKey(r.idempotency_key) === key);
    if (
      byKey &&
      normalizeEmail(byKey.email) === email &&
      phoneDigitsMatch(byKey.phone, phone)
    ) {
      return { reuse: byKey, reason: 'idempotency_key' };
    }
  }

  const matching = rows
    .filter((r) => normalizeEmail(r.email) === email)
    .filter((r) => phoneDigitsMatch(r.phone, phone))
    .filter((r) => String(r.admin_status || '') !== 'rejected')
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  if (matching.length === 0) return { reuse: null, reason: null };

  // Prefer pending/matched/approved over inventing a second open submission.
  const preferred =
    matching.find((r) => ['pending', 'matched', 'approved'].includes(String(r.admin_status || ''))) ||
    matching[0];

  return { reuse: preferred, reason: 'email_phone_match' };
}

/**
 * Whether a retry should return the existing row without re-notifying.
 * Always true when we intentionally reused a row for duplicate protection.
 */
function isDuplicatePrevention(reason) {
  return reason === 'idempotency_key' || reason === 'email_phone_match';
}

module.exports = {
  normalizeEmail,
  normalizePhoneDigits,
  phoneLast10,
  phoneDigitsMatch,
  normalizeIdempotencyKey,
  extractPreTripDraftIdFromDocumentUrl,
  resolveSubmissionDraftId,
  pickReusableSubmission,
  isDuplicatePrevention,
};
