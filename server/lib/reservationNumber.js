/**
 * Customer-facing reservation number derived from the booking UUID.
 * Does not replace bookings.id — display and optional lookup aid only.
 */

const RESERVATION_NUMBER_RE = /^LZC-([0-9A-F]{4})$/i;

function formatReservationNumber(bookingId) {
  const hex = String(bookingId || '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  return `LZC-${hex.slice(-4).toUpperCase()}`;
}

function parseReservationNumber(raw) {
  const match = String(raw || '')
    .trim()
    .toUpperCase()
    .match(RESERVATION_NUMBER_RE);
  return match ? `LZC-${match[1]}` : null;
}

function reservationNumberMatches(bookingId, raw) {
  const expected = formatReservationNumber(bookingId);
  const provided = parseReservationNumber(raw);
  return Boolean(expected && provided && expected === provided);
}

module.exports = {
  formatReservationNumber,
  parseReservationNumber,
  reservationNumberMatches,
};
