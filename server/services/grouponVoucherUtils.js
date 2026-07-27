/**
 * Groupon voucher normalization, hashing, and display masking.
 * Full voucher numbers are never logged or stored.
 */
const crypto = require('crypto');

const VOUCHER_HASH_SECRET =
  String(process.env.GROUPON_VOUCHER_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'groupon-dev-secret')
    .trim();

function normalizeVoucherNumber(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function normalizeOwnerName(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeOwnerNameForMatch(raw) {
  return normalizeOwnerName(raw).toLowerCase();
}

function extractLastName(ownerName) {
  const parts = normalizeOwnerName(ownerName).split(' ').filter(Boolean);
  if (!parts.length) return '';
  return parts[parts.length - 1].toLowerCase();
}

function voucherLastFour(normalizedVoucher) {
  const v = normalizeVoucherNumber(normalizedVoucher);
  if (v.length <= 4) return v;
  return v.slice(-4);
}

function hashVoucherNumber(normalizedVoucher) {
  const v = normalizeVoucherNumber(normalizedVoucher);
  return crypto.createHmac('sha256', VOUCHER_HASH_SECRET).update(v).digest('hex');
}

function maskVoucherLastFour(lastFour) {
  const tail = String(lastFour || '').trim().toUpperCase();
  if (!tail) return '••••';
  return `•••• ${tail}`;
}

function normalizeDealOrOptionText(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeHeaderName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGrouponDateTime(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const m = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!m) return null;
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const ampm = m[6].toUpperCase();
  if (ampm === 'AM') {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-05:00`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function parseCurrencyToCents(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function normalizeBooleanLike(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(v)) return 'yes';
  if (['false', 'no', 'n', '0'].includes(v)) return 'no';
  return v || '';
}

function normalizeRedeemedFlag(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'yes') return 'Yes';
  if (v === 'no') return 'No';
  return String(raw || '').trim();
}

function sanitizeCsvExportCell(value) {
  const text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) return `'${text}`;
  return text;
}

module.exports = {
  normalizeVoucherNumber,
  normalizeOwnerName,
  normalizeOwnerNameForMatch,
  extractLastName,
  voucherLastFour,
  hashVoucherNumber,
  maskVoucherLastFour,
  normalizeDealOrOptionText,
  normalizeHeaderName,
  parseGrouponDateTime,
  parseCurrencyToCents,
  normalizeBooleanLike,
  normalizeRedeemedFlag,
  sanitizeCsvExportCell,
};
