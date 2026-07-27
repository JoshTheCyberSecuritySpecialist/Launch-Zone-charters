/**
 * Signed short-lived Groupon reservation session tokens (server-only).
 */
const crypto = require('crypto');

const TOKEN_SECRET = String(
  process.env.GROUPON_VOUCHER_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'groupon-dev-secret'
).trim();

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function signReservationToken({ voucherId, sessionToken, expMs }) {
  const payload = `${voucherId}.${sessionToken}.${expMs}`;
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
}

function issueReservationSession({ voucherId, sessionToken, ttlMs = DEFAULT_TTL_MS }) {
  const expMs = Date.now() + ttlMs;
  const sig = signReservationToken({ voucherId, sessionToken, expMs });
  const raw = JSON.stringify({ v: voucherId, s: sessionToken, e: expMs, sig });
  return {
    clientToken: Buffer.from(raw).toString('base64url'),
    expiresAt: new Date(expMs).toISOString(),
    reservationExpiresAt: new Date(expMs).toISOString(),
  };
}

function verifyReservationClientToken(clientToken) {
  try {
    const parsed = JSON.parse(Buffer.from(String(clientToken || ''), 'base64url').toString('utf8'));
    const voucherId = String(parsed?.v || '').trim();
    const sessionToken = String(parsed?.s || '').trim();
    const expMs = Number(parsed?.e);
    const sig = String(parsed?.sig || '').trim();
    if (!voucherId || !sessionToken || !Number.isFinite(expMs) || !sig) {
      return { ok: false, reason: 'invalid_token' };
    }
    if (Date.now() > expMs) {
      return { ok: false, reason: 'expired_token' };
    }
    const expected = signReservationToken({ voucherId, sessionToken, expMs });
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'invalid_token' };
    }
    return { ok: true, voucherId, sessionToken, expiresAt: new Date(expMs).toISOString() };
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  issueReservationSession,
  verifyReservationClientToken,
};
