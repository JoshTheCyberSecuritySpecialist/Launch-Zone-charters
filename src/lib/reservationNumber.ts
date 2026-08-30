/**
 * Customer-facing reservation number derived from the booking UUID.
 * Does not replace bookings.id — display and optional lookup aid only.
 */

const RESERVATION_NUMBER_RE = /^LZC-([0-9A-F]{4})$/i;

export function formatReservationNumber(bookingId: string | null | undefined): string | null {
  const hex = String(bookingId || '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  return `LZC-${hex.slice(-4).toUpperCase()}`;
}

export function parseReservationNumber(raw: string | null | undefined): string | null {
  const match = String(raw || '')
    .trim()
    .toUpperCase()
    .match(RESERVATION_NUMBER_RE);
  return match ? `LZC-${match[1]}` : null;
}

export function reservationNumberMatches(
  bookingId: string | null | undefined,
  raw: string | null | undefined
): boolean {
  const expected = formatReservationNumber(bookingId);
  const provided = parseReservationNumber(raw);
  return Boolean(expected && provided && expected === provided);
}
