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
  pickReusableSubmission,
  isDuplicatePrevention,
};
