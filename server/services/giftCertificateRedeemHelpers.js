/**
 * Pure helpers for gift certificate redemption (no DB / Supabase imports).
 */

const { BIO_SEASONS } = require('../config/bioluminescenceSeason');

function normalizeGiftCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function seasonForCertificate(row) {
  const year = Number(row?.season_year) || 2027;
  const configured = BIO_SEASONS[String(year)];
  return {
    year,
    bookingStart: String(row?.valid_from || configured?.bookingStart || `${year}-06-01`).slice(0, 10),
    bookingEnd: String(row?.valid_until || configured?.bookingEnd || `${year}-10-31`).slice(0, 10),
    salesOpen: true,
  };
}

function publicGiftCertificateView(row) {
  if (!row) return null;
  const status = String(row.status || '').toLowerCase();
  const season = seasonForCertificate(row);
  return {
    giftCode: String(row.gift_code || '').toUpperCase(),
    status,
    redeemable: status === 'active',
    packageId: row.package_id || null,
    packageName: row.package_name || null,
    guestCount: Number(row.guest_count) || 1,
    recipientName: row.recipient_name || null,
    fromName: row.from_name || null,
    giftMessage: row.gift_message || null,
    seasonYear: season.year,
    validFrom: season.bookingStart,
    validUntil: season.bookingEnd,
    redeemedAt: row.redeemed_at || null,
    capacityConsumed: status === 'redeemed',
  };
}

module.exports = {
  normalizeGiftCode,
  seasonForCertificate,
  publicGiftCertificateView,
};
