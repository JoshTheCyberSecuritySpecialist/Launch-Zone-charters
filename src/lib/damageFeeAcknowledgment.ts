/** Keep aligned with server/lib/damageFeeAcknowledgment.js */

export function requiresDamageFeeAcknowledgment(bookingMode: 'rental' | 'charter'): boolean {
  return bookingMode !== 'charter';
}
