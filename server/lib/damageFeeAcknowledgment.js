'use strict';

/**
 * Rental-only damage / financial-responsibility acknowledgment.
 * Captain-led charters (bio, rocket, sunset, shared/private) do not require it.
 */

function isCharterProduct({ bookingMode, bookingType, tripType } = {}) {
  const trip = String(tripType || '')
    .trim()
    .toLowerCase();
  if (trip === 'captain_charter') return true;
  const mode = String(bookingMode || bookingType || '')
    .trim()
    .toLowerCase();
  return mode === 'charter';
}

function requiresDamageFeeAcknowledgment(input = {}) {
  return !isCharterProduct(input);
}

function damageFeeAcknowledgmentMissing({
  damageFeeAcknowledged,
  bookingMode,
  bookingType,
  tripType,
} = {}) {
  if (!requiresDamageFeeAcknowledgment({ bookingMode, bookingType, tripType })) return false;
  return !Boolean(damageFeeAcknowledged);
}

function storedDamageFeeAcknowledged({
  damageFeeAcknowledged,
  bookingMode,
  bookingType,
  tripType,
} = {}) {
  if (!requiresDamageFeeAcknowledgment({ bookingMode, bookingType, tripType })) return false;
  return Boolean(damageFeeAcknowledged);
}

module.exports = {
  isCharterProduct,
  requiresDamageFeeAcknowledgment,
  damageFeeAcknowledgmentMissing,
  storedDamageFeeAcknowledged,
};
